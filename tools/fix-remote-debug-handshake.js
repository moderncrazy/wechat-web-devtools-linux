#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const begin = "/* wechat-devtools linux remote debug handshake begin */";
const end = "/* wechat-devtools linux remote debug handshake end */";

function stripPatch(source, file) {
    const start = source.indexOf(begin);
    if (start === -1) return source;
    const finish = source.indexOf(end, start);
    if (finish === -1 || source.slice(finish + end.length).trim() ||
        source.indexOf(begin, start + begin.length) !== -1) {
        throw new Error(`Invalid existing remote debug handshake patch in ${file}`);
    }
    return source.slice(0, start);
}

function patchRemoteDebugHandshake(packageDir) {
    const jsDir = path.join(packageDir, "js");
    const candidates = fs.readdirSync(jsDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
        .map(entry => {
            const file = path.join(jsDir, entry.name);
            const source = fs.readFileSync(file, "utf8");
            return { file, source, original: stripPatch(source, file) };
        })
        .filter(({ original }) => /\bexports\.VendorService\s*=/.test(original) &&
            original.includes("getFileByProject(") && original.includes("readFileFromWXVPKG("));
    if (candidates.length !== 1) {
        throw new Error(`Expected one VendorService module, found ${candidates.length}`);
    }
    const { file, source, original } = candidates[0];
    const patch = fs.readFileSync(path.join(__dirname, "../res/scripts/remote-debug-handshake.js"), "utf8");
    const result = `${original.trimEnd()}\n${patch}`;
    if (result !== source) fs.writeFileSync(file, result);
    return file;
}

if (require.main === module) {
    const packageDir = path.resolve(process.argv[2] || path.join(__dirname, "../resources/app"));
    console.info(`Patched remote debug handshake: ${patchRemoteDebugHandshake(packageDir)}`);
}

module.exports = { patchRemoteDebugHandshake };
