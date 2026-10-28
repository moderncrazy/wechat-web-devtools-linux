/* wechat-devtools linux filesystem size cache begin */
;(() => {
    if (process.platform !== "linux") return;
    try {
        const prototype = exports.DirSizeCache.prototype;
        const patched = Symbol.for("wechat-devtools.filesystem-size-cache");
        if (prototype[patched]) return;
        if (typeof prototype.getSize !== "function" || typeof prototype._calcSize !== "function") {
            throw new Error("Unsupported DirSizeCache implementation");
        }
        // Native appendFile/writeFile pass whole file sizes to an incremental
        // cache. Read filesystem metadata so repeated writes cannot consume
        // imaginary quota. Bypass the throttled calcSize refresh as well.
        prototype.getSize = async function (directory) {
            return this._calcSize(directory);
        };
        Object.defineProperty(prototype, patched, { value: true });
    } catch (error) {
        console.error("[filesystem-size-cache] Patch initialization failed:", error.message);
    }
})();
/* wechat-devtools linux filesystem size cache end */
