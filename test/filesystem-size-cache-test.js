"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "fixtures/dir-size-cache-2.02.2608080.js"), "utf8");
const patchPath = path.join(__dirname, "../res/scripts/filesystem-size-cache.js");
const patch = fs.readFileSync(patchPath, "utf8");
class Pool {
    constructor() { this.tasks = []; }
    addTask(fn, arg) { this.tasks.push(() => fn(arg)); }
    async runAllAsync() { await Promise.all(this.tasks.map(task => task())); }
}
function cacheFixture(t, { patched = true, platform = "linux" } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-size-cache-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fileService = { lstat: fs.promises.lstat, readdir: fs.promises.readdir };
    const exports = {};
    const requireFixture = name => {
        if (name === "licia/lazyImport") return req => req;
        if (name === "tslib") return { __decorate: (_items, target) => target, __param: () => () => {} };
        if (name === "path") return path;
        if (name.includes("113e73")) return Pool;
        return { throttle: () => () => {} };
    };
    const errors = [];
    const context = vm.createContext({ exports, require: requireFixture, process: { platform, stderr: { write: error => errors.push(error) } }, console: { error() {} } });
    vm.runInContext(source, context);
    if (patched) { vm.runInContext(patch, context); vm.runInContext(patch, context); }
    return { dir, cache: new exports.DirSizeCache(fileService), errors };
}
test("upstream cached increments reproduce a false-full quota after repeated appendFile totals", async t => {
    const { dir, cache } = cacheFixture(t, { patched: false });
    const file = path.join(dir, "own-log");
    fs.writeFileSync(file, "1234");
    assert.equal(await cache.getSize(dir), 4);
    for (let i = 0; i < 4; i++) {
        fs.appendFileSync(file, "x");
        cache.updateSize(dir, fs.statSync(file).size); // Native appendFile passes its new file total.
    }
    assert.equal(fs.statSync(file).size, 8);
    assert.equal(await cache.getSize(dir), 30);
});
test("repeated native appendFile accounting cannot block a screenshot with enough real space", async t => {
    const { dir, cache } = cacheFixture(t);
    const file = path.join(dir, "own-log");
    fs.writeFileSync(file, "1234");
    await cache.getSize(dir);
    for (let i = 0; i < 4; i++) {
        fs.appendFileSync(file, "x");
        cache.updateSize(dir, fs.statSync(file).size);
    }
    assert.equal(await cache.getSize(dir), 8);
    assert.ok(await cache.getSize(dir) + 2 <= 10, "the screenshot must fit in the actual remaining quota");
});
test("overwrite, shrink and removeSavedFile operations report actual byte usage", async t => {
    const { dir, cache } = cacheFixture(t);
    const file = path.join(dir, "own-image");
    for (const bytes of [4, 9, 2, 0]) {
        fs.writeFileSync(file, "x".repeat(bytes));
        cache.updateSize(dir, bytes); // Native writeFile also passes the complete new size.
        assert.equal(await cache.getSize(dir), bytes);
    }
    fs.writeFileSync(file, "123456");
    cache.outdate(dir);
    fs.unlinkSync(file);
    cache.updateSize(dir, -6);
    assert.equal(await cache.getSize(dir), 0, "deleted screenshots cannot create a negative quota cache");
});
test("the real quota is still enforced rather than disabled or enlarged", async t => {
    const { dir, cache } = cacheFixture(t);
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "data"), "x".repeat(11));
    assert.ok(await cache.getSize(dir) + 2 > 10);
});
test("filesystem errors remain errors", async t => {
    const { dir, cache } = cacheFixture(t);
    await assert.rejects(cache.getSize(path.join(dir, "missing")), /ENOENT/);
});
test("other platforms keep the upstream behavior", async t => {
    const { dir, cache } = cacheFixture(t, { platform: "darwin" });
    fs.writeFileSync(path.join(dir, "data"), "1234");
    await cache.getSize(dir);
    cache.updateSize(dir, 4);
    assert.equal(await cache.getSize(dir), 8);
});
