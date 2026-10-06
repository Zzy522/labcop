# 第三方代码与资源

本项目原始代码采用AGPLv3 only；第三方代码、二进制和素材保持原许可。根目录LICENSE不替换这些许可。

| 资源 | 来源与版本依据 | 许可与随附声明 |
| --- | --- | --- |
| `public/rdkit/RDKit_minimal.js` / `.wasm` | `@rdkit/rdkit`，锁文件版本2025.3.4-1.0.0；安装脚本从该包复制 | BSD-3-Clause，完整声明见[public/rdkit/LICENSE](public/rdkit/LICENSE) |
| `public/ketcher/` | [EPAM Ketcher](https://github.com/epam/ketcher)，现有包内标识2.6.4、构建日期2022-12-01 | Apache-2.0；见[LICENSE](public/ketcher/LICENSE)、[NOTICE](public/ketcher/NOTICE)及保留的[打包依赖声明](public/ketcher/static/js/main.998da0b9.js.LICENSE.txt) |
| npm依赖 | `package-lock.json`记录直接与间接依赖版本，安装产物包含各包的声明 | 按每个包的LICENSE/NOTICE处理，不统一改成AGPL |
| 容器基础层 | Dockerfile的Node镜像与网关Caddy镜像 | 保留镜像上游的软件许可和声明；正式发布记录实际镜像digest |

Ketcher现有静态包不是由本项目锁文件重建；包内版本字符串不等同于完整来源证明。正式发布前应核对原分发包与对应源标签，检查其嵌入字体、模板及间接依赖声明，并记录文件哈希。此表不是完整依赖SBOM或全面许可证兼容性审计。

更新RDKit时执行`npm ci`会同时更新浏览器资源和许可副本。更新Ketcher时，保留该版本的LICENSE、NOTICE及打包依赖声明，记录来源和修改；不要仅替换压缩JS而丢弃声明。
