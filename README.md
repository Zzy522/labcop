# Lab Copilot

面向课题组的实验室协作与科研管理平台，支持试剂库存、设备预约、审批、巡检资质、课题任务与文档、化合物资料和AI助手。支持课题组自行部署，数据保存在自己选择的服务器。

在线服务：[labcopai.com](https://labcopai.com)。社区源码版本：`v0.1.0`；[发行说明](docs/release-notes.md)。使用指南含 64 张线上实拍截图，覆盖绘图查询、化合物录入、课题进度、周报及管理功能。账号需按实例流程申请，仓库不包含线上数据和账号凭据。

![分子结构查询](docs/screenshots/online-20261006/27-structure-drawing.png)

- [新手部署指南](docs/self-hosting-guide.md)：本机、校内服务器、云服务器和快捷脚本。
- [带截图的使用指南](docs/user-guide.md)：功能、角色和实际操作流程。
- [功能与使用边界](docs/product-guide.md)、[安全与限制](docs/security-and-limitations.md)。
- [贡献说明](CONTRIBUTING.md)。

本项目为单机单应用实例，SQLite与进程内调度不支持直接扩为多个应用副本。模型调用需要自行配置服务和凭据，不包含模型额度。先通过部署指南中的验收步骤，再保存真实课题资料。

Linux/macOS已安装Python3.9+、Docker和Compose2.30+后：

```sh
sh deploy/setup.sh init --mode local --admin-email admin@example.org
sh deploy/setup.sh up
```

Windows在项目目录使用`python deploy/selfhost.py init --mode local --admin-email admin@example.org`和`python deploy/selfhost.py up`，或使用`deploy/setup.ps1`。

Linux由管理员使用`sudo sh deploy/setup.sh ...`；已经是root时无需sudo。macOS使用普通终端。数据与证书权限、备份和目标环境验收见部署指南。

许可：GNU AGPLv3 only（`AGPL-3.0-only`），见[LICENSE](LICENSE)。支持收费部署、维护和定制；修改后的网络服务应按许可向使用者提供对应源码。第三方组件保留其原许可证。

维护者：[Zzy522](https://github.com/Zzy522)，微信`jingzbdcjl`。
