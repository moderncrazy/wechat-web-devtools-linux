"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "fixtures/remote-debug-proxy-3.17.5.js"), "utf8");
const patch = fs.readFileSync(path.join(__dirname, "../res/scripts/remote-debug-handshake.js"), "utf8");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function fixture() {
    const listeners = new Map();
    let clock = 0, timerId = 0;
    const timers = new Map();
    const setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: clock + ms }); return id; };
    const clearTimeout = id => timers.delete(id);
    const advance = ms => { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } };
    const sent = [];
    const bridge = {
        subscribe: (name, fn) => bridge.addSubscribeListener(name, fn),
        addSubscribeListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
        },
        removeSubscribeListener(name, fn) {
            const list = listeners.get(name) || [];
            const index = list.indexOf(fn);
            if (index >= 0) list.splice(index, 1);
        },
        // Native dispatch walks the live array; synchronous removal skips a waiter.
        async emit(name, data, from) {
            const list = listeners.get(name) || [];
            for (let index = 0; index < list.length; index++) await list[index](data, from);
        },
        publish(name, data, targets) { sent.push({ name, data, targets }); },
        listenerCount(name) { return (listeners.get(name) || []).length; },
    };
    class VendorService {
        async getFileByProject() { return { content: Buffer.from(source) }; }
        async readFileFromWXVPKG() { return source; }
    }
    vm.runInNewContext(patch, { exports: { VendorService }, process: { platform: "linux" }, Buffer, Promise });
    const content = (await new VendorService().getFileByProject()).content.toString();
    const context = { e: () => bridge, i: () => false, setTimeout, clearTimeout, Promise };
    vm.runInNewContext(`${content};globalThis.ProxyInspectee=c;`, context);
    return { proxy: new context.ProxyInspectee(), bridge, sent, advance };
}

test("a redirect does not strand the final page behind an old handshake", async () => {
    const { proxy, bridge, sent, advance } = await fixture();
    proxy.setCurrentWebviewId(12);
    let oldOutcome;
    proxy.handleCommand("DOM", "getDocument", {}).then(
        () => { oldOutcome = "resolved"; }, error => { oldOutcome = error.message; });
    await flush();
    proxy.setCurrentWebviewId(14);
    const current = proxy.handleCommand("DOM", "getDocument", {});
    await flush();
    bridge.emit("ensureRemoteDebugDone", {}, 14);
    await flush();
    const commands = sent.filter(x => x.name === "remoteDebugCommand");
    assert.equal(commands.length, 2, "the new page must not be stranded behind the old waiter");
    const oldCommand = commands.find(x => x.targets[0] === 12);
    const newCommand = commands.find(x => x.targets[0] === 14);
    assert.ok(oldCommand, "an old command must retain its original target");
    assert.ok(newCommand, "the final page command must be sent");
    bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: oldCommand.data.callbackID, data: { code: -32000, message: "page destroyed" } }, 12);
    bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: newCommand.data.callbackID, data: { root: "final-page" } }, 14);
    await flush();
    assert.equal(oldOutcome, "page destroyed");
    assert.equal((await current).root, "final-page");
});

test("the SDK global readiness event preserves each request's destination", async () => {
    const { proxy, bridge, sent } = await fixture();
    proxy.setCurrentWebviewId(14);
    const result = proxy.handleCommand("DOM", "getDocument", {});
    await flush();
    bridge.emit("ensureRemoteDebugDone", {}, 0);
    await flush();
    const command = sent.find(x => x.name === "remoteDebugCommand");
    assert.deepEqual(Array.from(command.targets), [14]);
    bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: command.data.callbackID, data: { root: "correct-page" } }, 14);
    assert.equal((await result).root, "correct-page");
});

test("concurrent queries share readiness without skipping another native subscriber", async () => {
    const { proxy, bridge, sent } = await fixture();
    proxy.setCurrentWebviewId(14);
    const results = [proxy.handleCommand("DOM", "getDocument", {}), proxy.handleCommand("WxComponent", "getComponentData", {})];
    let notified = false;
    bridge.addSubscribeListener("ensureRemoteDebugDone", () => { notified = true; });
    await flush();
    assert.equal(sent.filter(x => x.name === "ensureRemoteDebug").length, 1);
    bridge.emit("ensureRemoteDebugDone", {}, 14);
    await flush();
    assert.equal(notified, true);
    const commands = sent.filter(x => x.name === "remoteDebugCommand");
    assert.deepEqual(commands.map(x => x.data.callbackID), ["1", "2"]);
    for (const command of commands) {
        bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: command.data.callbackID, data: { method: command.data.method } }, 14);
    }
    assert.deepEqual((await Promise.all(results)).map(x => x.method), ["DOM.getDocument", "WxComponent.getComponentData"]);
});

test("patching preserves strings, buffers and unrelated vendor files and is idempotent", async () => {
    class VendorService {
        async getFileByProject(text) { return { content: Buffer.from(text), path: "vendor.js" }; }
        async readFileFromWXVPKG(text) { return text; }
    }
    const errors = [];
    const context = { exports: { VendorService }, process: { platform: "linux" }, Buffer, Promise, console: { error: (...args) => errors.push(args.join(" ")) } };
    vm.runInNewContext(patch, context);
    vm.runInNewContext(patch, context);
    const reader = new VendorService();
    const first = await reader.getFileByProject(source);
    assert.equal(first.path, "vendor.js");
    assert.ok(Buffer.isBuffer(first.content));
    assert.equal(await reader.readFileFromWXVPKG(first.content.toString()), first.content.toString());
    assert.equal(await reader.readFileFromWXVPKG("other vendor source"), "other vendor source");
    const unsupported = source.replace("async handleCommand(t,n,...r)", "async handleCommand(t,n,...changed)");
    assert.equal(await reader.readFileFromWXVPKG(unsupported), unsupported);
    assert.match(errors[0], /Unsupported WARemoteDebug/);
});

test("independent Runtime and DOM targets can initialize concurrently", async () => {
    const { proxy, bridge, sent } = await fixture();
    proxy.setCurrentWebviewId(0);
    const service = proxy.handleCommand("Runtime", "evaluate", {}).catch(error => ({ error: error.message }));
    await flush();
    proxy.setCurrentWebviewId(14);
    const page = proxy.handleCommand("DOM", "getDocument", {});
    await flush();
    bridge.emit("ensureRemoteDebugDone", {}, 14);
    await flush();
    bridge.emit("ensureRemoteDebugDone", {}, 0);
    await flush();
    const commands = sent.filter(x => x.name === "remoteDebugCommand");
    assert.equal(commands.length, 2, "switching DOM targets must not cancel independent Runtime initialization");
    for (const command of commands) {
        const target = command.targets[0];
        bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: command.data.callbackID, data: { target } }, target);
    }
    assert.equal((await service).target, 0);
    assert.equal((await page).target, 14);
});

test("a lost handshake is bounded and a later request can initialize the same page", async () => {
    const { proxy, bridge, sent, advance } = await fixture();
    proxy.setCurrentWebviewId(14);
    const first = proxy.handleCommand("DOM", "getDocument", {}).catch(error => error.message);
    await flush();
    advance(9000);
    await flush();
    assert.match(await first, /handshake deadline exceeded/);
    const second = proxy.handleCommand("DOM", "getDocument", {});
    await flush();
    assert.equal(sent.filter(x => x.name === "ensureRemoteDebug").length, 2);
    bridge.emit("ensureRemoteDebugDone", {}, 14);
    await flush();
    const command = sent.find(x => x.name === "remoteDebugCommand");
    bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: command.data.callbackID, data: { root: "ready" } }, 14);
    assert.equal((await second).root, "ready");
});

test("an awaited native subscriber cannot strand another page's handshake", async () => {
    const { proxy, bridge, sent, advance } = await fixture();
    proxy.setCurrentWebviewId(12);
    const old = proxy.handleCommand("DOM", "getDocument", {});
    let release;
    bridge.addSubscribeListener("ensureRemoteDebugDone", () => new Promise(resolve => { release = resolve; }));
    proxy.setCurrentWebviewId(14);
    const current = proxy.handleCommand("DOM", "getDocument", {});
    await flush();
    const dispatch = bridge.emit("ensureRemoteDebugDone", {}, 14);
    await flush();
    advance(0);
    release();
    await dispatch;
    await flush();
    const commands = sent.filter(x => x.name === "remoteDebugCommand");
    assert.equal(commands.length, 2, "listener cleanup must not shift the native array while another subscriber is awaited");
    for (const command of commands) bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: command.data.callbackID, data: { target: command.targets[0] } }, command.targets[0]);
    assert.equal((await old).target, 12);
    assert.equal((await current).target, 14);
});

test("repeated navigation keeps a bounded native readiness subscription", async () => {
    const { proxy, bridge, sent, advance } = await fixture();
    for (let target = 1; target <= 12; target++) {
        proxy.setCurrentWebviewId(target);
        const result = proxy.handleCommand("DOM", "getDocument", {});
        await flush();
        await bridge.emit("ensureRemoteDebugDone", {}, target);
        await flush();
        const command = sent.filter(x => x.name === "remoteDebugCommand").at(-1);
        await bridge.emit("remoteDebugInfo", { command: "DEBUGGEE_CALLBACK", callbackID: command.data.callbackID, data: { target } }, target);
        assert.equal((await result).target, target);
        advance(0);
        assert.equal(bridge.listenerCount("ensureRemoteDebugDone"), 1);
    }
});

test("does not alter vendor reads on other platforms", async () => {
    class VendorService { async readFileFromWXVPKG() { return source; } }
    vm.runInNewContext(patch, { exports: { VendorService }, process: { platform: "darwin" } });
    assert.equal(await new VendorService().readFileFromWXVPKG(), source);
});
