/* wechat-devtools linux remote debug handshake begin */
;(() => {
    if (process.platform !== "linux") return;
    try {
        const marker = "/* linux remote debug handshake lifecycle */";
        const methods = {
            ensureWebviewRemoteDebug(target) {
                if (this.webviewRemoteDebugEnsure) return this.webviewRemoteDebugEnsure;
                const bridge = e();
                if (!this._linuxRemoteDebugReadyWaiters) {
                    const waiters = new Set();
                    // The SDK proxy is a singleton, like its permanent
                    // remoteDebugInfo subscription. Never mutate the native ready
                    // listener array while it is dispatching asynchronous callbacks.
                    bridge.addSubscribeListener("ensureRemoteDebugDone", () => {
                        const pending = [...waiters];
                        waiters.clear();
                        for (const ready of pending) ready();
                    });
                    this._linuxRemoteDebugReadyWaiters = waiters;
                }
                const waiters = this._linuxRemoteDebugReadyWaiters;
                let resolve, reject, timer;
                const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
                let settled = false;
                const cleanup = () => { clearTimeout(timer); waiters.delete(done); };
                const fail = error => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (this.webviewRemoteDebugEnsure === promise) this.webviewRemoteDebugEnsure = null;
                    reject(error);
                };
                const done = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve();
                };
                this.webviewRemoteDebugEnsure = promise;
                waiters.add(done);
                // Clean up before the bridge's existing 10s RPC deadline. No
                // business command is replayed when a readiness event is lost.
                timer = setTimeout(() => fail(new Error(`remote debug handshake deadline exceeded for webview ${target}`)), 9000);
                try { bridge.publish("ensureRemoteDebug", {}, [target]); }
                catch (error) { fail(error); }
                return promise;
            },
            async handleCommand(domain, method, ...args) {
                const target = this.currentWebviewId;
                if (target === undefined) throw new Error("no current webview id");
                if (!i()) await this.ensureWebviewRemoteDebug(target);
                // Allocate only after readiness so an older waiter cannot publish
                // a lower callback ID after a newer command and be deduplicated.
                const id = (this.callbackId++).toString();
                let resolve, reject;
                const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
                this.callbackMap.set(id, { resolve, reject, promise });
                const command = { method: `${domain}.${String(method)}`, commandParams: args[0], callbackID: id };
                try {
                    e().publish("remoteDebugCommand", { ...command, data: command }, [target]);
                    return await promise;
                } catch (error) {
                    this.callbackMap.delete(id);
                    throw error;
                }
            },
        };
        const originalSet = "setCurrentWebviewId(e){this.currentWebviewId!==e&&(this.currentWebviewId=e,this.webviewRemoteDebugEnsure=null)}";
        const originalCommand = "async handleCommand(t,n,...r){if(void 0===this.currentWebviewId)throw new Error(\"no current webview id\");var o,s,a=(this.callbackId++).toString(),l=new Promise(((e,t)=>{o=e,s=t}));this.callbackMap.set(a,{resolve:o,reject:s,promise:l});var c={method:`${t}.${String(n)}`,commandParams:r[0],callbackID:a};return i()||(this.webviewRemoteDebugEnsure||(this.webviewRemoteDebugEnsure=new Promise((t=>{var n=()=>{e().removeSubscribeListener(\"ensureRemoteDebugDone\",n),t()};e().addSubscribeListener(\"ensureRemoteDebugDone\",n),e().publish(\"ensureRemoteDebug\",{},[this.currentWebviewId])}))),await this.webviewRemoteDebugEnsure),e().publish(\"remoteDebugCommand\",{...c,data:c},[this.currentWebviewId]),l}";
        function transform(content) {
            if (!content.includes("this.webviewRemoteDebugEnsure") || !content.includes("remoteDebugCommand")) return content;
            if (content.includes(marker)) return content;
            if (content.split(originalSet).length !== 2 || content.split(originalCommand).length !== 2) {
                throw new Error("Unsupported WARemoteDebug handshake source; update the Linux lifecycle patch");
            }
            return content.replace(originalCommand, marker + methods.ensureWebviewRemoteDebug.toString() + methods.handleCommand.toString());
        }
        const patched = Symbol.for("wechat-devtools.remote-debug-handshake");
        const prototype = exports.VendorService.prototype;
        if (prototype[patched]) return;
        for (const name of ["getFileByProject", "readFileFromWXVPKG"]) {
            const original = prototype[name];
            prototype[name] = async function (...args) {
                const result = await original.apply(this, args);
                const content = result?.content ?? result;
                if (!Buffer.isBuffer(content) && typeof content !== "string") return result;
                const source = content.toString();
                let next;
                try {
                    next = transform(source);
                } catch (error) {
                    console.error("[remote-debug-handshake] Foundation patch not applied:", error.message);
                    return result;
                }
                if (next === source) return result;
                const value = Buffer.isBuffer(content) ? Buffer.from(next) : next;
                return result?.content !== undefined ? { ...result, content: value } : value;
            };
        }
        Object.defineProperty(prototype, patched, { value: true });
    } catch (error) {
        console.error("[remote-debug-handshake] Patch initialization failed:", error.message);
    }
})();
/* wechat-devtools linux remote debug handshake end */
