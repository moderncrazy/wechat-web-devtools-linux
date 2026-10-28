/* wechat-devtools linux superseded routes begin */
;(() => {
    if (process.platform !== "linux") return;
    try {
        const prototype = exports.default.prototype;
        const marker = Symbol.for('wechat-devtools.superseded-routes');
        if (prototype[marker]) return;
        const markRouteBegin = prototype.markRouteBegin;
        prototype.markRouteBegin = function (type, ...args) {
            if (type === 'reLaunch') {
                // reLaunch replaces the page stack. A removed page that never
                // received OnAppRoute cannot become ready or unblock this queue.
                this.eventQueue = this.eventQueue.filter(entry => entry.routeEventSend);
            }
            return markRouteBegin.call(this, type, ...args);
        };
        Object.defineProperty(prototype, marker, { value: true });
    } catch (error) {
        process.stderr.write('[wechat-devtools] Failed to patch superseded routes: ' + error.stack + '\n');
    }
})();
/* wechat-devtools linux superseded routes end */
