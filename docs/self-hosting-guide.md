# Lab Copilot 新手部署指南

适用于单机、单应用实例。最后核对：2026-10-06。快捷工具为 `deploy/setup.sh`、`deploy/setup.ps1`，共用 Python 实现，不会修改已有生产 `.env` 和 `data/`。

首次使用建议先在自己的电脑试用，再选择校内服务器或云服务器。本指南中的“服务器”指负责保存全组数据并持续运行服务的机器；其他成员只需要浏览器，不需要各自安装数据库。

## 1. 选择部署方式

| 方式 | 地址与访问范围 | 适合谁 | 快捷模式 |
| --- | --- | --- | --- |
| 自己的电脑试用 | `http://localhost:3000`，仅当前电脑 | 学习、功能评估 | `local` |
| 校内/局域网服务器 | 如 `https://192.168.1.20`，校内网络或 VPN | 希望资料保留在课题组 | `lan` |
| 云服务器 | 如 `https://lab.example.org` | 校外协作、长期在线 | `public` |
| 学校已有 HTTPS 网关 | 学校分配的 HTTPS 地址 | 已有反向代理和证书 | `proxy` |

`lan` 和 `public` 自动启动 Caddy 网关。`lan` 使用实例自己的 CA 证书，客户端需要信任它；`public` 使用域名自动申请证书。`proxy` 由学校已有网关提供 HTTPS，应用仅监听服务器回环地址。

本机模式不向局域网开放。想让全组使用时选择服务器模式，不要把每位成员的本地数据库当成一套共享数据库。

## 2. 准备机器和软件

### 资源建议

这是初始规划建议，不是经过容量测试的用户数承诺：运行成品镜像可从 2 核、4 GB 内存、40 GB 可用磁盘起步；**首次从源码构建建议至少 8 GB 内存或在独立构建机完成**。预留附件、数据库、备份和 Docker 镜像空间。模型调用默认走外部 API，不需要 GPU；离线模型另行评估。

云服务器租赁时选择支持 Docker 的 Linux、持久系统盘/数据盘，并核对地区、续费价、带宽与快照费用。首次可用 Ubuntu LTS 等 Docker 官方支持的发行版；不要只按首年促销价决定长期预算。

学校机器先向管理员确认：能否运行 Docker、能否使用 80/443 端口、是否有固定地址/域名、如何提供校外 VPN、数据备份和维护由谁负责。普通账号没有安装权限时，请由学校管理员安装 Docker，不用脚本擅自修改系统。

自己的电脑作为长期服务器时，需要保持开机、关闭自动休眠、设置稳定地址，并考虑断电和网络中断。路由器 NAT、校园防火墙和运营商网络条件会影响校外访问；需要时使用学校批准的 VPN。

### 安装前置软件

- Python **3.9 或更高**：[官方下载](https://www.python.org/downloads/)。Windows 安装时勾选添加到 PATH，安装后重新打开终端。
- Docker Engine / Docker Desktop，以及 Docker Compose **2.30 或更高**。Linux 参考 [Docker Engine 安装文档](https://docs.docker.com/engine/install/)；Windows 参考 [Docker Desktop 安装文档](https://docs.docker.com/desktop/setup/install/windows-install/)；macOS 参考 [Docker Desktop 安装文档](https://docs.docker.com/desktop/setup/install/mac-install/)。Docker Desktop 的使用许可另按其官方条款核对。
- 获取源码可以安装 Git，也可以从 GitHub Release 下载源码压缩包后解压。Docker 和 Python 不会由本项目脚本自动安装。

Linux/macOS 终端检查：

```sh
python3 --version
docker info
docker compose version
```

Windows PowerShell 检查：

```powershell
py -3 --version
docker info
docker compose version
```

`docker info` 应返回服务信息。Windows/macOS 必须先打开 Docker Desktop，等待引擎就绪；Windows 通常还需要启用 Docker 官方要求的 WSL2/虚拟化。Linux 当前账号需要合法的 Docker 操作权限。

**Linux快捷工具需要管理员权限。**迁移器把数据卷交给容器UID1001，Caddy的私钥目录也有严格权限；仅加入Docker组不能保证宿主机备份程序能读取它们。下文的`sh deploy/setup.sh ...`在Linux一律使用`sudo sh deploy/setup.sh ...`（已经是root时无需sudo）。请学校/服务器管理员执行，不要放宽数据和私钥权限。macOS与Windows保持普通终端运行，具体文件共享权限需按目标环境验收。

## 3. 获取项目，先固定版本

公开仓库：[Zzy522/labcop](https://github.com/Zzy522/labcop)。首个社区源码版本为 **v0.1.0**，包含部署工具和使用指南。当前未分发预构建容器镜像或 Windows/macOS 安装包，快捷脚本从源码构建。

从 Releases 下载选定源码版本，或克隆仓库并检出固定标签。不要在运行真实数据的目录直接跟随开发分支。

```sh
git clone https://github.com/Zzy522/labcop.git
cd labcop
git checkout v0.1.0
```

以下命令均在解压/克隆后的项目目录执行。快捷入口只要求宿主机有 Python 和 Docker；不要求在宿主机安装 Node.js、Prisma 或 SQLite。

## 4. 自己电脑：最快试用

Linux/macOS：

```sh
sh deploy/setup.sh init --mode local --admin-email admin@example.org
sh deploy/setup.sh up
```

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\setup.ps1 init --mode local --admin-email admin@example.org
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\setup.ps1 up
```

`ExecutionPolicy Bypass` 只作用于这一次 PowerShell 进程。也可以直接使用 `python deploy/selfhost.py init ...` 和 `python deploy/selfhost.py up`，无需运行 PowerShell 文件。

把邮箱换成自己的平台管理员邮箱。配置向导会询问管理员密码，至少16位；留空会随机生成并保存在 `.selfhost/app.env`，不会打印到终端。SMTP 可暂留空，本机管理员仍可登录，但普通注册/找回密码需要邮件配置。

第一次 `up` 默认从源码构建两个镜像，可能耗时较长。之后会复用镜像；`up --build` 才强制重建。只有应用和最终访问地址都通过健康检查，工具才输出启动成功。

打开 `http://localhost:3000/developer-login`，使用初始化邮箱和密码登录平台管理端。普通 `/login` 页面供实验室成员和管理员使用；平台管理员使用独立入口。

在自己电脑上用文本编辑器打开 `.selfhost/app.env` 可以查看生成密码。不要截图、粘贴或上传完整配置文件；不要在共享终端运行会打印全部配置的命令。

## 5. 校内服务器/局域网

先由学校管理员提供固定 IPv4 地址，例如 `192.168.1.20`。在该服务器运行：

```sh
sh deploy/setup.sh init --mode lan --url https://192.168.1.20 --admin-email admin@example.org
```

填写 SMTP 服务，再执行：

```sh
sh deploy/setup.sh up
```

服务器开放 80/443 给批准的校园网/VPN范围，应用3000端口不会直接开放。多台实例共用一台服务器时，80/443 会冲突，建议由现有统一网关代理，并使用 `proxy` 模式。

### 信任校内 HTTPS 证书

启动后，CA 公共证书在 `.selfhost/caddy-data/caddy/pki/authorities/local/root.crt`，路径按[Caddy官方Docker部署说明](https://caddyserver.com/docs/running#local-https-with-docker)核对。由管理员通过可信渠道向成员发放，先核对指纹，再导入受信任根证书。Windows 可通过证书管理器导入当前用户的“受信任的根证书颁发机构”；macOS 使用钥匙串；Linux 按系统/浏览器的证书管理方式导入。不同浏览器的证书存储可能不同，导入后重启浏览器。

**仅分发 `root.crt`，绝不分发 `root.key` 或整个 caddy-data 目录。**不要要求成员忽略浏览器证书警告。学校有正式域名和证书时，优先使用其统一网关。

### 学校已有网关

```sh
sh deploy/setup.sh init --mode proxy --url https://lab.school.example --port 3000 --admin-email admin@example.org
```

网关应在**同一台宿主机**代理到 `http://127.0.0.1:3000`；保持正确 Host、转发协议与客户端地址，支持流式响应并关闭响应缓冲，读取超时建议不少于300秒，请求体限额至少60 MB。独立网关机器不能访问本机回环地址，应由学校管理员设计受保护的网络连接，不直接把应用端口暴露公网。

网关配置完成后执行 `up`。工具会检查最终 HTTPS 地址；服务健康但域名尚未可用时，仍会报告未完成。

## 6. 租赁云服务器并公网部署

1. 在云控制台创建 Linux 实例，保存 SSH 登录方式。通过控制台核对 SSH 主机指纹，再连接服务器；初次部署可由平台提供的网页终端操作。
2. 安装 Docker、Compose 和 Python，按第2节验证。让管理员按云厂商文档配置账号与权限。
3. 准备域名，例如 `lab.example.org`。DNS 的 A 记录指向服务器公网 IPv4；如果设置 AAAA，必须保证 IPv6 实际可达。
4. 云安全组和服务器防火墙开放80/443；SSH22端口限制管理来源。数据库和应用3000端口不需要公网开放。
5. 获取固定版本源码，进入项目目录，运行：

```sh
sh deploy/setup.sh init --mode public --url https://lab.example.org --admin-email admin@example.org
sh deploy/setup.sh up
```

填写真实 SMTP 服务器、端口、发件邮箱及授权密码。Caddy 自动处理域名证书和续期。证书申请仍依赖正确 DNS、入口可达及证书机构限制；工具会验证 HTTPS，不会把申请失败报告为成功。此模式只配置指定的一个域名，不会额外申请 `www`。

浏览器访问该域名及 `/developer-login`。服务器所属地区涉及的域名、服务发布和数据要求，由运营方在正式公开前核对。

## 7. 配置邮件、AI，并邀请课题组

`.selfhost/app.env` 使用每行 `变量名=值`，值不要再加引号或换行；Compose 按原样读取，密码中的 `$` 和 `#` 不会展开成环境变量。新增或修改设置后运行 `up` 重建容器。

邮件至少配置 `SMTP_HOST`、`SMTP_PORT`，需要登录的服务还应配置 `SMTP_USER`、`SMTP_PASS`。465一般为TLS，587一般为STARTTLS，具体按邮箱服务商说明填写。先用测试邮箱验证验证码和找回密码确实送达，再开放注册。未配置邮件时，不承诺普通账号入驻可用。

模型密钥可由成员/实验室在“API配置”页填写，也可配置平台默认 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。模型名和接口以所选服务商实际支持为准；不配置时库存、设备和课题管理仍可使用，AI功能可能不可用。OCR/VLM分别按页面说明配置。

第一次入驻：负责人提交创建实验室申请 → 平台管理员审批 → 负责人分发加入码 → 成员注册并申请加入 → 负责人审批。详细操作与截图见[使用指南](user-guide.md)。测试按钮不会在生产自动创建演示账号。

## 8. 日常运行命令

Linux/macOS 使用 `sh deploy/setup.sh`；Windows 使用 `python deploy/selfhost.py`，后面的子命令一致。

| 子命令 | 作用 |
| --- | --- |
| `init` | 创建配置；已有 `.selfhost` 时拒绝覆盖 |
| `up` | 构建或拉取镜像，必要时备份，停写迁移，启动并验收 |
| `up --build` | 源码升级时强制重建 |
| `status` | 查看容器状态 |
| `doctor` | 检查配置、Docker及Compose状态，不打印密钥 |
| `logs` | 显示最近100行日志，分享前先脱敏 |
| `down` | 停止服务，保留配置、数据和备份 |
| `backup` | 短暂停止写入，检查数据库，制作一致性备份并恢复原运行服务 |
| `restore 备份路径` | 校验备份后恢复到全新实例目录，拒绝覆盖已有实例 |

同一实例的修改操作有锁。异常退出留下 `.selfhost/operation.lock` 时，先确认没有部署、迁移、备份进程运行，再人工移除该锁；不要一看到锁就删除。

## 9. 数据、备份和灾难恢复

`.selfhost/data/` 保存数据库和业务附件；`.selfhost/app.env` 保存加密密钥和初始化密码；`settings.json`、`compose.yaml` 和网关目录保存实例配置。它们全部被Git忽略，不能进入公开源码或镜像。

```sh
sh deploy/setup.sh backup
```

备份保存在 `.selfhost/backups/`，同时生成 `.sha256` 校验文件。**这是包含明文凭据的受控归档，不是加密备份。**校验文件用于检测损坏，不证明未知来源备份可信。使用加密磁盘或受控加密存储，把归档和校验文件复制到另一台机器；同机备份不能抵御整盘损坏。可由管理员用系统计划任务定期调用该命令，并配置失败通知。

恢复时下载与备份对应的源码版本到另一个目录，在该目录运行：

```sh
sh deploy/setup.sh restore /absolute/path/to/backup.tar.gz
sh deploy/setup.sh doctor
# 确认原版本镜像/源码、访问地址、SMTP、证书与文件权限，再启动。
sh deploy/setup.sh up
```

脚本保留原加密密钥，检查数据库与归档路径，重写新目录挂载路径。已经有 `.selfhost` 的目录不能恢复覆盖。域名换机器还需要修改DNS；同一校内实例的CA要保持一致。定期在空白环境演练并记录恢复时间。

## 10. 升级与成品镜像

源码升级：阅读变更和迁移说明 → 主动备份并制作异机副本 → 保存旧版本源码/镜像 → 获取已发布新版本 → `up --build` → 验证登录、角色、库存、预约、课题和文件。启动现有数据库时脚本还会自动制作一份停写备份。

迁移失败时应用保持停止，避免旧程序继续写入发生变化的数据库；先查看迁移日志，不执行 `migrate reset`、开发seed或删除数据。数据库变更后，换回旧镜像不一定兼容；需要恢复时在新目录恢复明确的备份，不覆盖已经确认的新业务数据。

预构建镜像发布后，可以在首次 `init` 同时传入 `--app-image` 和 `--migrator-image`，必须是同一发布版本；使用发行说明中的实际标签或digest，避免追随 `latest`。当前尚未发布成品镜像，不提供看似可用的假镜像地址。

## 11. 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 找不到Docker/引擎未运行 | 启动Docker Desktop或Docker服务，重新执行 `docker info` |
| Docker权限不足 | 请管理员授予合法权限；不要修改数据库权限来解决Docker权限 |
| `init` 提示配置已存在 | 使用 `up`；新建另一目录才能建立另一实例，不覆盖旧密钥 |
| 镜像构建失败/内存不足 | 检查日志、网络、磁盘和内存；使用独立构建机或已发布成品镜像 |
| 登录后立即退出 | 检查最终访问协议、HTTPS网关和Cookie设置，不把公网安全Cookie改成false |
| 邮箱验证码收不到 | 核对SMTP、授权密码、发件地址和垃圾邮件；管理员登录成功不代表邮件已可用 |
| 校内证书不受信任 | 核实并安装该实例CA，或使用学校正式证书 |
| 公网证书失败 | 检查A/AAAA记录、80/443、安全组和gateway日志，不能直接忽略证书错误 |
| 上传返回413 | 检查学校已有网关限额；快捷网关为60MB，应用各功能仍有独立限制 |
| AI无回复 | 检查模型配置、余额、权限与上游可达性；部署应用不会赠送模型额度 |
| 预约/审批失败 | 检查成员角色、资质、时间冲突和申请状态，按具体业务提示处理 |

## 12. 验证记录与边界

2026-10-06 已完成 Windows 上的配置工具与备份恢复测试，并在现有 Linux 生产环境完成应用镜像构建、数据库副本演练、加密备份验证和发布，线上健康检查通过。使用指南截图来自该线上版本。**这不等于所有快捷部署模式已经端到端验收：Windows/macOS Docker 启动、校内 CA、快捷入口首次证书签发和新 SMTP 配置仍需在目标环境验证。**按本节验收清单完成自己的部署后，再保存真实课题资料。

SQLite和进程内调度适用于单机单实例；增加容器副本并不自动获得可靠多实例能力。容量、备份策略和实验室隔离仍按[安全与限制](security-and-limitations.md)的验收要求处理。
