/* wechat-devtools linux automator bind begin */
;(() => {
    if (process.platform !== "linux" || process.env.WECHAT_DEVTOOLS_AUTOMATOR_HOST !== "0.0.0.0") return;
    try {
        const prototype = exports.AutomatorServerService.prototype;
        const marker = Symbol.for("wechat-devtools.automator-bind");
        if (prototype[marker]) return;
        const original = prototype.startServer;
        if (typeof original !== "function") throw new Error("Unsupported AutomatorServerService.startServer");
        prototype.startServer = function (port) {
            return original.call(this, port, "0.0.0.0");
        };
        Object.defineProperty(prototype, marker, { value: true });
    } catch (error) {
        console.error("[automator-bind] Patch initialization failed:", error.message);
    }
})();
/* wechat-devtools linux automator bind end */
