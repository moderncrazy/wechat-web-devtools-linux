# wxdt-automator 运行时镜像
# 微信开发者工具(Linux 移植版) + Xvfb/noVNC + 自动化服务端口
#
# 前置：把工具包 tar.gz 放到本目录，命名为 WeChat_Dev_Tools_continuous.tar.gz
#   （源码自建：tmp/build/WeChat_Dev_Tools_*_x86_64_linux.tar.gz 的改名拷贝）
# 构建：docker build -t wxdt-automator:latest .
# 规格：../DEPLOY.md §4

FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive

# Electron 运行库全套 + X11/noVNC + 中文字体（§4.3 #6）
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl xz-utils locales \
        xvfb fluxbox x11vnc novnc websockify \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
        libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxinerama1 \
        libxcursor1 libxi6 libdrm2 libxkbcommon0 libcups2 \
        libpango-1.0-0 libcairo2 \
        fonts-wqy-zenhei fonts-wqy-microhei fontconfig \
    && locale-gen zh_CN.UTF-8 \
    && rm -rf /var/lib/apt/lists/*
ENV LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 WECHAT_DEVTOOLS_AUTOMATOR_HOST=0.0.0.0

# Node 22：构建期跑 patch-asar.js + 运行期跑 smoke-test（miniprogram-automator）
# 注：NodeSource 脚本直灌 root 属供应链审计中危项（docker/Dockerfile.electron 同款做法），
#     信任要求高时可改为锁定 digest 的 node 官方镜像多阶段拷贝。
RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/ns.sh && bash /tmp/ns.sh \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -f /tmp/ns.sh && rm -rf /var/lib/apt/lists/*

# 工具包：必须镜像内解压（tar 含符号链接 electron/resources，Windows 侧解压必坏 §4.3 #5）
COPY tool.tar.gz /tmp/tool.tar.gz
RUN tar -zxf /tmp/tool.tar.gz -C /opt \
    && mv /opt/WeChat_Dev_Tools_* /opt/wechat-devtools \
    && rm -f /tmp/tool.tar.gz \
    && test -x /opt/wechat-devtools/bin/wechat-devtools
ENV TOOL_DIR=/opt/wechat-devtools
# 注意：这里不把工具 bin 提前放进 PATH —— 工具自带的 bin/node 是
# ELECTRON_RUN_AS_NODE 包装脚本，docker build 里以 root 运行会段错误；
# 构建期的 node/npm 必须用系统版本（/usr/bin/node）。PATH 在文末统一导出。

# ---- CLI 三处 sed 修复（§4.3 #1~#3，作用于 app.asar.unpacked/js/common/cli/index.js）----
# 先验证锚点存在：工具包版本漂移时在这里大声失败，而不是构建出坏镜像
RUN CLI="/opt/wechat-devtools/resources/app.asar.unpacked/js/common/cli/index.js" \
 && grep -qE 'slice\([A-Za-z_$][A-Za-z0-9_$]*\?3:4\)' "$CLI" \
 && grep -q 'global\.enableCLI' "$CLI" \
 && echo "CLI fix anchors present" \
 || { echo "ERROR: CLI 修复锚点未找到（工具包版本与 DEPLOY.md 记录不符），用 node patch-asar.js --inspect 思路核对实际代码"; exit 1; }
# #1 argv 切片：bin/node 引导重排 argv 后多切 1 个参数，auto 子命令被吃掉（只打印全局帮助）
# #2 CLI 拉起 IDE 补上 --enable-service-port（global.enableCLI 从未被赋值 → 恒真）
# #3 CLI 等 IDE 端口超时 30s → 300s（容器冷启动 ~90s）
RUN CLI="/opt/wechat-devtools/resources/app.asar.unpacked/js/common/cli/index.js" \
 && sed -i -E 's/slice\([A-Za-z_$][A-Za-z0-9_$]*\?3:4\)/slice(3)/g' "$CLI" \
 && sed -i 's/global\.enableCLI/!0/g' "$CLI" \
 && sed -i 's/3e4/3e5/g' "$CLI" \
 && ! grep -qE 'slice\([A-Za-z_$][A-Za-z0-9_$]*\?3:4\)' "$CLI" \
 && ! grep -q 'global\.enableCLI' "$CLI" \
 && echo "CLI sed fixes #1~#3 applied"

# ---- asar 等长补丁：IDE 服务端口启动门修复（§4.3 #4）----
# 用系统 node（/usr/bin/node）：裸 `node` 若被工具 bin/node 包装脚本截获会段错误
COPY patch-asar.js /opt/tools/patch-asar.js
RUN /usr/bin/node /opt/tools/patch-asar.js /opt/wechat-devtools/resources/app.asar
COPY fix-automator-bind.js automator-bind.js /opt/tools/
RUN /usr/bin/node /opt/tools/fix-automator-bind.js /opt/wechat-devtools/resources/app.asar /opt/tools/automator-bind.js

# ---- 入口编排 ----
COPY entrypoint.sh /opt/tools/entrypoint.sh
RUN chmod +x /opt/tools/entrypoint.sh

# ---- 冒烟测试（automator 全 API 验证，登录后手动跑）----
RUN mkdir -p /opt/smoke && cd /opt/smoke && npm init -y >/dev/null 2>&1 \
    && npm install --no-audit --no-fund miniprogram-automator \
       --registry=https://registry.npmmirror.com
COPY smoke-test.js /opt/smoke/smoke-test.js

# 冒烟用小程序 + 默认项目挂载点（run 时 -v .../dist:/projects/dist 覆盖）
COPY testapp /projects/testapp
RUN mkdir -p /projects/dist

# PATH 统一在此导出（所有构建期 node/npm 步骤已结束）
ENV PATH="/opt/wechat-devtools/bin:${PATH}"

EXPOSE 9420 6080 5900
WORKDIR /projects
ENTRYPOINT ["/opt/tools/entrypoint.sh"]

ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/moderncrazy/wechat-web-devtools-linux" \
      org.opencontainers.image.revision="$SOURCE_REVISION"
