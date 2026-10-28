#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const begin = "/* wechat-devtools linux automator bind begin */";
const end = "/* wechat-devtools linux automator bind end */";
function patchAutomatorBind(archive, patchFile = path.join(__dirname, "../res/scripts/automator-bind.js")) {
    const bytes = fs.readFileSync(archive);
    const tree = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
    const payload = bytes.subarray(8 + bytes.readUInt32LE(4));
    const candidates = [];
    for (const [name, entry] of Object.entries(tree.files.js.files)) {
        if (!name.endsWith(".js") || entry.offset === undefined) continue;
        const source = payload.subarray(Number(entry.offset), Number(entry.offset) + entry.size).toString();
        let original = source;
        if (source.includes(begin)) {
            const start = source.indexOf(begin), finish = source.indexOf(end, start);
            if (finish < 0 || source.slice(finish + end.length).trim() || source.indexOf(begin, start + begin.length) >= 0) throw new Error("Invalid existing automator bind patch");
            original = source.slice(0, start);
        }
        if (/\bexports\.AutomatorServerService\s*=/.test(original) && original.includes("startServer(") && original.includes("bindPreferredOrFreePort(")) candidates.push({ name, entry, source, original });
    }
    if (candidates.length !== 1) throw new Error(`Expected one AutomatorServerService module, found ${candidates.length}`);
    const { name, entry, source, original } = candidates[0];
    const next = original.trimEnd() + "\n" + fs.readFileSync(patchFile, "utf8");
    if (next === source) return name;
    const content = Buffer.from(next);
    entry.offset = String(payload.length);
    entry.size = content.length;
    if (entry.integrity) {
        const blockSize = entry.integrity.blockSize || 4194304;
        const hash = b => crypto.createHash("sha256").update(b).digest("hex");
        entry.integrity = { algorithm: "SHA256", hash: hash(content), blockSize, blocks: [] };
        for (let i = 0; i < content.length; i += blockSize) entry.integrity.blocks.push(hash(content.subarray(i, i + blockSize)));
    }
    const json = Buffer.from(JSON.stringify(tree));
    const string = Buffer.alloc(4 + Math.ceil(json.length / 4) * 4);
    string.writeUInt32LE(json.length); json.copy(string, 4);
    const header = Buffer.alloc(4); header.writeUInt32LE(string.length);
    const size = Buffer.alloc(8); size.writeUInt32LE(4); size.writeUInt32LE(header.length + string.length, 4);
    fs.writeFileSync(archive, Buffer.concat([size, header, string, payload, content]));
    return name;
}
if (require.main === module) console.info("Patched automator bind:", patchAutomatorBind(process.argv[2], process.argv[3]));
module.exports = { patchAutomatorBind };
