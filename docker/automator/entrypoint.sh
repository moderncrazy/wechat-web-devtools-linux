#!/bin/bash
# wxdt-automator 容器入口：Xvfb → IDE → cli auto → 保活
# 编排规格：../DEPLOY.md §5.2（含 docker restart 防残留清理 §6.4）
set -u

DISPLAY_NUM="${DISPLAY_NUM:-99}"
AUTO_PORT="${AUTO_PORT:-9420}"          # 容器内自动化 ws 端口
VNC_HTTP_PORT="${VNC_HTTP_PORT:-6080}"  # noVNC 页面端口
VNC_PORT="${VNC_PORT:-5900}"            # x11vnc 内部端口，不映射
PROJECT="${PROJECT:-/projects/testapp}"
TOOL_DIR="${TOOL_DIR:-/opt/wechat-devtools}"
IDE_WAIT_TIMEOUT="${IDE_WAIT_TIMEOUT:-240}"

export DISPLAY=":$DISPLAY_NUM"
export LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8

echo "[entrypoint] PROJECT=$PROJECT AUTO_PORT=$AUTO_PORT VNC=${ENABLE_VNC:-0}"

# 数据目录定位：与 bin/wechat-devtools-cli + res/scripts/cli.js 的 userDirPath 映射保持一致
#   <DATA_DIR>/<APP_NAME>/app/Default/  ← .ide/.cli/.ide-status 所在的 profile 目录
DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
APP_NAME=$(grep -Eo 'name":".*","main' "$TOOL_DIR/resources/app.asar.unpacked/package.json" \
           | sed -e 's/name":"//' -e 's/","main//')
if [ -z "$APP_NAME" ]; then
    echo "✖ 无法从 package.json 解析 APP_NAME"
    exit 1
fi
PROFILE_DIR="$DATA_DIR/$APP_NAME/app/Default"
mkdir -p "$PROFILE_DIR" "$DATA_DIR/$APP_NAME/Default"

# 1. 清理上次会话残留（docker restart 保留文件系统）
#    X 锁残留 → Xvfb 绑不上 :99 → Electron 段错误
#    .ide 残留死端口 → cli auto 误判 IDE 已启动去连死端口 → 超时
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"
rm -f "$PROFILE_DIR/.ide" "$PROFILE_DIR/.cli" \
      "$DATA_DIR/$APP_NAME/Default/.ide" "$DATA_DIR/$APP_NAME/Default/.cli"

# 2. 虚拟显示 + 窗口管理器（+ 可选 x11vnc/noVNC）
Xvfb ":$DISPLAY_NUM" -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
sleep 1
fluxbox >/tmp/fluxbox.log 2>&1 &
if [ "${ENABLE_VNC:-0}" = "1" ]; then
    x11vnc -display ":$DISPLAY_NUM" -rfbport "$VNC_PORT" -nopw -forever -shared \
           >/tmp/x11vnc.log 2>&1 &
    websockify --web=/usr/share/novnc "$VNC_HTTP_PORT" "localhost:$VNC_PORT" \
               >/tmp/websockify.log 2>&1 &
    echo "[entrypoint] noVNC ready: http://localhost:$VNC_HTTP_PORT/vnc.html"
fi

# 3. 预置握手状态（PR #172：cli 以 .ide-status 判定 IDE 状态）
printf 'On' > "$PROFILE_DIR/.ide-status"

# 4. 直启 IDE（--enable-service-port：asar 补丁已恒真放行，此处参数双保险）
"$TOOL_DIR/bin/wechat-devtools" --cli --remote-port 3799 --enable-service-port \
    >/tmp/ide.log 2>&1 &
IDE_PID=$!

# 5. 等 .ide 握手文件（IDE 服务就绪信号）
i=0
while [ "$i" -lt "$IDE_WAIT_TIMEOUT" ]; do
    [ -f "$PROFILE_DIR/.ide" ] && break
    if ! kill -0 "$IDE_PID" 2>/dev/null; then
        echo "✖ IDE 进程启动即退出 — /tmp/ide.log 末尾："
        tail -n 30 /tmp/ide.log
        exit 1
    fi
    sleep 1
    i=$((i + 1))
done
if [ ! -f "$PROFILE_DIR/.ide" ]; then
    echo "✖ ${IDE_WAIT_TIMEOUT}s 内未见 .ide 握手文件 — /tmp/ide.log 末尾："
    tail -n 30 /tmp/ide.log
    exit 1
fi
echo "✔ IDE server started ($(head -c 120 "$PROFILE_DIR/.ide" | tr -d '\n'))"

# 6. cli auto：挂载项目 + 开自动化端口
cd "$TOOL_DIR"
if "$TOOL_DIR/bin/wechat-devtools-cli" auto --project "$PROJECT" --auto-port "$AUTO_PORT" \
       >/tmp/cli-auto.log 2>&1; then
    APPID=$(grep -Eo 'wx[0-9a-f]{16}' /tmp/cli-auto.log "$PROJECT/project.config.json" 2>/dev/null \
            | grep -Eo 'wx[0-9a-f]{16}' | head -1)
    [ -n "$APPID" ] && echo "✔ Using AppID $APPID"
    echo "✔ auto (automation ws on 0.0.0.0:$AUTO_PORT)"
    tail -n 10 /tmp/cli-auto.log
else
    echo "✖ cli auto 失败 — /tmp/cli-auto.log 末尾："
    tail -n 40 /tmp/cli-auto.log
    exit 1
fi

# 7. 保活：自动化 ws 服务寄生在 IDE 进程里，IDE 死则退出容器
#    （配合 docker run --restart=unless-stopped 实现自愈，entrypoint 重跑清理残留）
while kill -0 "$IDE_PID" 2>/dev/null; do
    sleep 15
done
echo "✖ IDE 进程退出，容器结束"
exit 1
