# 自动化容器镜像

源码仓库：https://github.com/moderncrazy/wechat-web-devtools-linux，分支 `electron`。

在 Linux x86_64 上执行 `tools/build-automator.sh`。脚本先通过已有 Docker 构建工具下载官方包、编译原生模块并应用本仓库补丁，再打包工具、构建含 Xvfb/noVNC/自动化服务的运行时镜像。宿主机仅需要 Docker、Git；Node.js 22 由构建容器提供。输出镜像默认以 Git 提交短哈希命名，可用 `WXDT_IMAGE` 指定标签；镜像 OCI 标签记录完整源码提交。

第二台机器可使用同一源码提交生成的工具包：`tools/build-automator.sh --runtime-only /path/WeChat_Dev_Tools_<version>_x86_64_linux.tar.gz`。该选项仅省略原生工具重复编译，运行时镜像仍在当前机器用本仓库 Dockerfile 构建。不要传入来源或源码版本不明的包。

`docker/automator/` 收录原运行环境已有的入口编排、CLI/service-port 兼容补丁及独立冒烟小程序。页面路由、远程调试握手和文件配额修复已接入标准工具构建。镜像不包含实际业务 dist、登录状态或用户配置；启动时挂载项目到 `/projects/dist`，配置卷到 `/root/.config`，设置 `PROJECT=/projects/dist` 和 `ENABLE_VNC=1`。

容器内部端口为 6080（noVNC）、9420（自动化 WebSocket），宿主机端口由部署选择。替换容器时保留原名称、挂载、端口绑定、内存、共享内存及重启策略；删除旧容器时不要使用 `-v`，不要执行全局 Docker prune。确认新镜像就绪后再删除目标旧容器及没有其他使用者的旧微信镜像。
