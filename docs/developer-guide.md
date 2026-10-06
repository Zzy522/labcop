# 社区版开发者指南

本项目使用Node.js24、Next.js16.3、React19、Prisma7和SQLite。确切依赖以package-lock.json为准。修改Next.js代码前阅读安装包`node_modules/next/dist/docs/`中的相关说明。

## 本地开发

```sh
npm ci
```

复制`.env.example`到`.env`，将DATABASE_URL改成独立开发库、NODE_ENV改成development、APP_BASE_URL改成本机地址，并生成自己的随机密钥。使用`npx tsx scripts/gen-secrets.ts`时，其输出包含密钥，不上传日志。不要连接生产库。

```sh
npx prisma migrate deploy
npm run seed:prod
npm run dev
```

`seed:prod`只是幂等平台管理员初始化脚本的名称，实际操作环境由配置决定；需要设置PLATFORM_ADMIN_EMAIL和至少16位的PLATFORM_ADMIN_PASSWORD。`npm run seed`是会清理数据的演示seed，不要用于生产。没有SMTP不能承诺普通注册邮件可用。

## 结构与授权

`src/app`为页面与接口，`src/lib`为鉴权、业务服务、AI和调度，`prisma`为数据库与迁移，`deploy`为自部署工具。服务端会话和成员关系授权；资源查询必须继续限定实验室及课题范围，不能信任客户端传来的角色、作者或labId。

文件存储与数据库不是跨系统原子事务，变更写入、文件和删除语义时需要同时考虑失败恢复。不要把根许可证强行覆盖到第三方依赖和素材。

## 验证

```sh
npm test
npx tsc --noEmit --incremental false
npm run lint
python -m unittest discover -s deploy
npm run build -- --webpack
```

安装或构建过程中会生成Prisma Client和Next.js类型。权限与写入修改应验证A/B实验室隔离、角色边界、重复请求、并发与附件访问。迁移需要使用副本演练并验证备份恢复。

部署见[新手部署指南](self-hosting-guide.md)，用户操作见[使用指南](user-guide.md)，贡献按[CONTRIBUTING](../CONTRIBUTING.md)处理。
