# 自动化容器镜像

源码仓库：https://github.com/moderncrazy/wechat-web-devtools-linux，分支 `electron`。

在 Linux x86_64 上执行 `tools/build-automator.sh`。脚本先通过已有 Docker 构建工具下载官方包、编译原生模块并应用本仓库补丁，再打包工具、构建含 Xvfb/noVNC/自动化服务的运行时镜像。宿主机仅需要 Docker、Git；Node.js 22 由构建容器提供。输出镜像默认以 Git 提交短哈希命名，可用 `WXDT_IMAGE` 指定标签；镜像 OCI 标签记录完整源码提交。

第二台机器可复用来源明确、原生依赖兼容的同版本工具包：`tools/build-automator.sh --runtime-only /path/WeChat_Dev_Tools_<version>_x86_64_linux.tar.gz`。该选项仅省略原生工具重复编译，运行时镜像仍在当前机器用本仓库 Dockerfile 构建，并应用当前的容器监听补丁。不要传入来源或源码版本不明的包。

`docker/automator/` 收录原运行环境已有的入口编排、CLI/service-port 兼容补丁及独立冒烟小程序。页面路由、远程调试握手和文件配额修复已接入标准工具构建。镜像不包含实际业务 dist、登录状态或用户配置；启动时挂载项目到 `/projects/dist`，配置卷到 `/root/.config`，设置 `PROJECT=/projects/dist` 和 `ENABLE_VNC=1`。

容器内部端口为 6080（noVNC）、9420（自动化 WebSocket），宿主机端口由部署选择。替换容器时保留原名称、挂载、端口绑定、内存、共享内存及重启策略；删除旧容器时不要使用 `-v`，不要执行全局 Docker prune。确认新镜像就绪后再删除目标旧容器及没有其他使用者的旧微信镜像。

运行镜像设置 `WECHAT_DEVTOOLS_AUTOMATOR_HOST=0.0.0.0`，只覆盖自动化服务监听地址；普通桌面启动未设置此变量时保留上游的 localhost 默认值。构建脚本向旧版 Docker builder 显式传入目标架构，并在镜像标签中记录 fork 源码提交。

## 2026-10-29 部署记录

运行镜像对应代码提交 `75079335eac3e02a455d2b681a3b057a9b23adba`，工具版本 `2.02.2609240`，镜像标签均为 `moderncrazy/wechat-web-devtools-linux:7507933`。

| 机器 | 同名容器 | 宿主机 noVNC / 自动化端口 | 镜像 ID 前缀 |
| --- | --- | --- | --- |
| 10.10.11.66 | wxdt-dist | 6082 / 9422 | 5e7b96537a5e |
| 47.117.125.123 | wxdt-regression-test | 6080 / 9420 | 4d8b30ee9102 |

两台源码目录均为各用户 home 下的 `Project/moderncrazy/wechat-web-devtools-linux`，origin 指向本 fork，分支 `electron`。原容器和旧微信运行镜像已删除；保留原配置卷、项目挂载、端口绑定、内存/共享内存和重启策略。

完整工具编译在 123 的 Docker 构建容器内完成，产物写回挂载的宿主机源码目录。11.66 初次完整编译遇到 OpenSSL 下载连接超时，最终复用 123 的同版本工具包，在 11.66 本机用本 fork Dockerfile 独立构建运行镜像。工具包 SHA256：`f1f912dbd2018c38c8d48999cc31fbca2c1923a8103c90cd495b072839c5dc85`。

验证：52 项相关 Node 回归通过；构建入口及入口脚本 bash 语法检查和 git diff 检查通过。两台镜像均在无网络、无用户配置卷的临时容器中验证版本及四项补丁唯一存在。123 外部 SDK 连接、3 次页面重开及 4 轮稳定 DOM 读取通过，10 次截图全部为有效 320×693 PNG，保存文件列表没有积累截图，已查看实际首页图片。

11.66 新容器和 noVNC 正常运行；原挂载项目返回 `APPID_ERROR: 需要重新登录`，截至本记录尚未通过真实项目 DOM/截图验证。请在 `http://10.10.11.66:6082/vnc.html` 扫码登录后重新执行 CLI auto 或由 Agent 重新准备环境，再补验证。CLI 可能在返回该业务错误时仍以 0 退出；不能将入口脚本的 auto 成功文案视为实际项目握手成功。

Case 215 保持停止，未继续原业务脚本、订单或支付流程；本次未修改 Agent 服务源码。

复核记录：再次检查两台 Docker 的实际状态，两个同名容器均为 running，镜像来源和代码提交标签与上表一致，原运行镜像均已不存在；两台源码工作区干净、origin 均为本 fork。容器归档中的路由、握手、配额和监听四项补丁逐字节 SHA256 均与提交 `7507933` 中的源文件相同。

额外执行 `bash test/startup-test.sh` 时，当前代码因桩环境缺少 `home/.config/wechat-devtools/app/settings.json` 以 2 退出；在独立临时目录还原 fork 原始提交 `9e10ba5` 后，同一命令以相同错误和退出码失败。这项既有启动桩失败未计入 52 项通过的相关回归，也未修改无关启动器来规避。实际部署容器启动与镜像代码来源已单独验证；11.66 的扫码登录仍是后续真实项目验证前提。
