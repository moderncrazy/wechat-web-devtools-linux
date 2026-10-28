"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { patchRemoteDebugHandshake } = require("../tools/fix-remote-debug-handshake");
const moduleSource = "exports.VendorService=class {async getFileByProject() {} async readFileFromWXVPKG() {}};\n";
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-handshake-patch-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, "js"));
    const file = path.join(dir, "js/vendor-version-dependent-name.js");
    fs.writeFileSync(file, moduleSource);
    return { dir, file };
}
test("finds the vendor module and applies and updates the patch once", t => {
    const { dir, file } = fixture(t);
    assert.equal(patchRemoteDebugHandshake(dir), file);
    const first = fs.readFileSync(file, "utf8");
    patchRemoteDebugHandshake(dir);
    assert.equal(fs.readFileSync(file, "utf8"), first);
    fs.writeFileSync(file, first.replace("if (process.platform", "// old patch\n    if (process.platform"));
    patchRemoteDebugHandshake(dir);
    assert.equal(fs.readFileSync(file, "utf8"), first);
});
test("ambiguous and missing modules fail before modifying sources", t => {
    const { dir, file } = fixture(t);
    const second = path.join(dir, "js/second.js");
    fs.writeFileSync(second, moduleSource);
    assert.throws(() => patchRemoteDebugHandshake(dir), /found 2/);
    assert.equal(fs.readFileSync(file, "utf8"), moduleSource);
    fs.unlinkSync(second);
    fs.unlinkSync(file);
    assert.throws(() => patchRemoteDebugHandshake(dir), /found 0/);
});

test("an installed patch cannot conceal a changed upstream export", t => {
    const { dir, file } = fixture(t);
    patchRemoteDebugHandshake(dir);
    const changed = fs.readFileSync(file, "utf8").replace("exports.VendorService=class", "exports.OtherService=class");
    fs.writeFileSync(file, changed);
    assert.throws(() => patchRemoteDebugHandshake(dir), /found 0/);
    assert.equal(fs.readFileSync(file, "utf8"), changed);
});
