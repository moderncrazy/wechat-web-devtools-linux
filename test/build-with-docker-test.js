"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
function build(t, architecture) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-docker-build-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const sub of ["tools", "docker", "bin"]) fs.mkdirSync(path.join(dir, sub));
    fs.copyFileSync(path.join(__dirname, "../tools/build-with-docker.sh"), path.join(dir, "tools/build-with-docker.sh"));
    fs.writeFileSync(path.join(dir, "docker/Dockerfile.electron"), "FROM ubuntu:20.04\n");
    fs.writeFileSync(path.join(dir, "bin/sha256sum"), "#!/bin/sh\nprintf '123456789abc  Dockerfile\\n'\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "bin/docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$BUILD_COMMAND_LOG"
case "$1" in
 image) exit 1 ;;
 info) printf '%s\\n' "$BUILD_ARCHITECTURE" ;;
esac
`, { mode: 0o755 });
    const log = path.join(dir, "commands");
    const result = spawnSync("bash", [path.join(dir, "tools/build-with-docker.sh")], { encoding: "utf8", env: { ...process.env, PATH: path.join(dir, "bin") + path.delimiter + process.env.PATH, BUILD_COMMAND_LOG: log, BUILD_ARCHITECTURE: architecture } });
    return { ...result, commands: fs.readFileSync(log, "utf8") };
}
for (const [input, expected] of [["x86_64", "amd64"], ["aarch64", "arm64"]]) {
    test(`legacy Docker builds receive the ${expected} target architecture`, t => {
        const result = build(t, input);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.commands, new RegExp(`build --build-arg TARGETARCH=${expected} `));
        assert.match(result.commands, /run --rm -i /);
    });
}
test("unsupported architectures fail before building or running", t => {
    const result = build(t, "unsupported");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported Docker build architecture/);
    assert.doesNotMatch(result.commands, /build --build-arg|run --rm/);
});
