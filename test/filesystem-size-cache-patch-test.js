"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { patchFilesystemSizeCache } = require("../tools/fix-filesystem-size-cache");
const moduleSource = "exports.DirSizeCache=class {getSize() {} _calcSize() {} updateSize() {} _dirSizeMap = new Map();};\n";
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-size-cache-patch-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, "js"));
    const file = path.join(dir, "js/vendor-version-dependent-name.js");
    fs.writeFileSync(file, moduleSource);
    return { dir, file };
}
test("finds the size cache module and applies and updates the patch once", t => {
    const { dir, file } = fixture(t);
    assert.equal(patchFilesystemSizeCache(dir), file);
    const first = fs.readFileSync(file, "utf8");
    patchFilesystemSizeCache(dir);
    assert.equal(fs.readFileSync(file, "utf8"), first);
    fs.writeFileSync(file, first.replace("if (process.platform", "// old patch\n    if (process.platform"));
    patchFilesystemSizeCache(dir);
    assert.equal(fs.readFileSync(file, "utf8"), first);
});
test("ambiguous and missing modules fail before modifying sources", t => {
    const { dir, file } = fixture(t);
    const second = path.join(dir, "js/second.js");
    fs.writeFileSync(second, moduleSource);
    assert.throws(() => patchFilesystemSizeCache(dir), /found 2/);
    assert.equal(fs.readFileSync(file, "utf8"), moduleSource);
    fs.unlinkSync(second);
    fs.unlinkSync(file);
    assert.throws(() => patchFilesystemSizeCache(dir), /found 0/);
});

test("an installed patch cannot conceal a changed upstream export", t => {
    const { dir, file } = fixture(t);
    patchFilesystemSizeCache(dir);
    const changed = fs.readFileSync(file, "utf8").replace("exports.DirSizeCache=class", "exports.OtherService=class");
    fs.writeFileSync(file, changed);
    assert.throws(() => patchFilesystemSizeCache(dir), /found 0/);
    assert.equal(fs.readFileSync(file, "utf8"), changed);
});
