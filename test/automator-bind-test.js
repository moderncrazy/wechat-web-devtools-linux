"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const { test } = require("node:test");
const { patchAutomatorBind } = require("../tools/fix-automator-bind");
const patch = fs.readFileSync(path.join(__dirname, "../res/scripts/automator-bind.js"), "utf8");
for (const [platform, host, expected] of [["linux", "0.0.0.0", "0.0.0.0"], ["linux", undefined, "127.0.0.1"], ["darwin", "0.0.0.0", "127.0.0.1"]]) {
    test(`listener preserves scope: ${platform}/${host}`, async () => {
        class Server { async startServer(port, address = "127.0.0.1") { return { port, address, server: this }; } }
        const context = vm.createContext({ exports: { AutomatorServerService: Server }, process: { platform, env: { WECHAT_DEVTOOLS_AUTOMATOR_HOST: host } }, console });
        vm.runInContext(patch, context); vm.runInContext(patch, context);
        const server = new Server(), result = await server.startServer(9420, "127.0.0.1");
        assert.equal(result.port, 9420); assert.equal(result.address, expected); assert.equal(result.server, server);
    });
}
function archive(t, sources) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-bind-asar-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let offset = 0; const files = {}, chunks = [];
    for (const [name, source] of Object.entries(sources)) { const b = Buffer.from(source); files[name] = { offset: String(offset), size: b.length }; chunks.push(b); offset += b.length; }
    const json = Buffer.from(JSON.stringify({ files: { js: { files } } }));
    const header = Buffer.alloc(16 + Math.ceil(json.length / 4) * 4);
    header.writeUInt32LE(4); header.writeUInt32LE(header.length - 8, 4); header.writeUInt32LE(header.length - 12, 8); header.writeUInt32LE(json.length, 12); json.copy(header, 16);
    const file = path.join(dir, "app.asar"); fs.writeFileSync(file, Buffer.concat([header, ...chunks])); return file;
}
const original = "exports.AutomatorServerService=class { async startServer(){} async bindPreferredOrFreePort(){} };";
test("archive patch is unique, idempotent and retains unrelated entries", t => {
    const file = archive(t, { "version-dependent.js": original, "unrelated.js": "unchanged" });
    assert.equal(patchAutomatorBind(file), "version-dependent.js"); const once = fs.readFileSync(file);
    patchAutomatorBind(file); assert.deepEqual(fs.readFileSync(file), once);
    const tree = JSON.parse(once.subarray(16, 16 + once.readUInt32LE(12))), base = 8 + once.readUInt32LE(4);
    const entry = tree.files.js.files["version-dependent.js"], other = tree.files.js.files["unrelated.js"];
    assert.equal(once.subarray(base + Number(entry.offset), base + Number(entry.offset) + entry.size).toString(), original + "\n" + patch);
    assert.equal(once.subarray(base + Number(other.offset), base + Number(other.offset) + other.size).toString(), "unchanged");
});
test("missing or ambiguous exports fail without modifying archives", t => {
    for (const sources of [{ "other.js": "exports.Other=class{}" }, { "a.js": original, "b.js": original }]) {
        const file = archive(t, sources), before = fs.readFileSync(file);
        assert.throws(() => patchAutomatorBind(file), /Expected one AutomatorServerService/);
        assert.deepEqual(fs.readFileSync(file), before);
    }
});
