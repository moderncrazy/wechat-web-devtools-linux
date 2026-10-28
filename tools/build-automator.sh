#!/usr/bin/env bash
set -euo pipefail
root_dir=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root_dir"
revision=$(git rev-parse HEAD)
image=${WXDT_IMAGE:-moderncrazy/wechat-web-devtools-linux:$(git rev-parse --short HEAD)}
context="$root_dir/tmp/automator"
mkdir -p "$context"
if [[ ${1:-} == --runtime-only ]]; then
    [[ $# == 2 && -f $2 ]] || { echo "Usage: $0 --runtime-only /path/to/source-built-tool.tar.gz" >&2; exit 2; }
    artifact=$(realpath "$2")
else
    [[ $# == 0 ]] || { echo "Usage: $0 [--runtime-only /path/to/source-built-tool.tar.gz]" >&2; exit 2; }
    "$root_dir/tools/build-with-docker.sh"
    version=$(node "$root_dir/tools/parse-config.js" --get-devtools-version)
    builder="wechat-devtools-build:electron-$(sha256sum "$root_dir/docker/Dockerfile.electron" | cut -c1-12)"
    docker run --rm -u "$(id -u):$(id -g)" -v "$root_dir:/workspace" -w /workspace \
        "$builder" bash tools/build-tar.sh "$version" x86_64
    artifact="$root_dir/tmp/build/WeChat_Dev_Tools_${version}_x86_64_linux.tar.gz"
fi
cp "$artifact" "$context/tool.tar.gz"
cp -a "$root_dir/docker/automator/." "$context/"
docker build --build-arg "SOURCE_REVISION=$revision" -t "$image" "$context"
printf 'Source revision: %s\nImage: %s\n' "$revision" "$image"
