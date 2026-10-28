"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { patchSupersededRoutes } = require("../tools/fix-superseded-routes");

const patch = fs.readFileSync(path.join(__dirname, "../res/scripts/superseded-routes.js"), "utf8");
// The upstream queue seam: readiness dispatches only the first queued route.
const moduleSource = `
exports.ERouteEvent = { ROUTE_READY: "ROUTE_READY" };
exports.default = class {
    constructor() { this.eventQueue = []; this.sent = []; this.current = { id: 10, ready: true }; }
    markRouteBegin(type) {
        this.eventQueue.push({ webviewID: this.current.id, status: "prepare" });
        if (this.current.ready) this.markRouteReady(this.current.id);
        return type;
    }
    markRouteReady(id) {
        const entry = this.eventQueue.find(item => item.webviewID === id);
        if (entry) {
            entry.status = "ready";
            if (this.eventQueue[0] === entry) this.sent.push(id);
        }
    }
    triggerAppRouteDone() {}
};
`;

function runtime() {
    const context = vm.createContext({ exports: {}, process: { platform: "linux", stderr: process.stderr } });
    vm.runInContext(moduleSource, context);
    vm.runInContext(patch, context);
    vm.runInContext(patch, context);
    return new context.exports.default();
}

test("a replaced page awaiting readiness cannot block reLaunch", () => {
    const controller = runtime();
    controller.eventQueue.push({ webviewID: 9, status: "prepare" });
    assert.equal(controller.markRouteBegin("reLaunch"), "reLaunch");
    assert.deepEqual(Array.from(controller.sent), [10]);
    assert.deepEqual(Array.from(controller.eventQueue, entry => entry.webviewID), [10]);
});

test("preserves dispatched routes until their completion", () => {
    const controller = runtime();
    const inFlight = { webviewID: 8, status: "ready", routeEventSend: true };
    controller.eventQueue.push(inFlight, { webviewID: 9, status: "prepare" });
    controller.markRouteBegin("reLaunch");
    assert.equal(controller.eventQueue[0], inFlight);
    assert.deepEqual(Array.from(controller.eventQueue, entry => entry.webviewID), [8, 10]);
    assert.equal(controller.sent.length, 0);
});

test("keeps the queue for ordinary navigation", () => {
    for (const type of ["navigateTo", "navigateBack", "redirectTo"]) {
        const controller = runtime();
        const pending = { webviewID: 9, status: "prepare" };
        controller.eventQueue.push(pending);
        controller.markRouteBegin(type);
        assert.equal(controller.eventQueue[0], pending);
        assert.equal(controller.sent.length, 0);
    }
});

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-route-patch-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, "js"));
    const file = path.join(dir, "js", "version-dependent.js");
    fs.writeFileSync(file, moduleSource);
    return { dir, file };
}

test("finds by upstream shape, applies idempotently, and replaces older patches", t => {
    const { dir, file } = fixture(t);
    fs.writeFileSync(path.join(dir, "js", "unrelated.js"), "exports.ERouteEvent = {};");
    assert.equal(patchSupersededRoutes(dir), file);
    const installed = fs.readFileSync(file, "utf8");
    assert.ok(installed.endsWith(patch));
    patchSupersededRoutes(dir);
    assert.equal(fs.readFileSync(file, "utf8"), installed);
    fs.writeFileSync(file, installed.replace("const marker =", "// previous patch\nconst marker ="));
    patchSupersededRoutes(dir);
    assert.equal(fs.readFileSync(file, "utf8"), installed);
});

test("rejects absent or ambiguous upstream modules before changing files", t => {
    const { dir, file } = fixture(t);
    const second = path.join(dir, "js", "second.js");
    fs.writeFileSync(second, moduleSource);
    assert.throws(() => patchSupersededRoutes(dir), /found 2/);
    assert.equal(fs.readFileSync(file, "utf8"), moduleSource);
    fs.unlinkSync(file);
    fs.unlinkSync(second);
    assert.throws(() => patchSupersededRoutes(dir), /found 0/);
});

test("rejects incomplete existing patches", t => {
    const { dir, file } = fixture(t);
    const damaged = moduleSource + "/* wechat-devtools linux superseded routes begin */";
    fs.writeFileSync(file, damaged);
    assert.throws(() => patchSupersededRoutes(dir), /Invalid existing/);
    assert.equal(fs.readFileSync(file, "utf8"), damaged);
});
