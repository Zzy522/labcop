# ───────────── 依赖安装阶段 ─────────────
FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# 先拷贝依赖描述与 prisma（postinstall 需要 schema 来 prisma generate）
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts ./scripts
RUN npm ci

# ───────────── 构建阶段（也作为 migrate/seed 执行器）─────────────
FROM node:24-slim AS builder
ARG APP_RELEASE
ENV APP_RELEASE=$APP_RELEASE
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 生成 Prisma Client + 构建 Next.js standalone
# 清除 tsconfig.tsbuildinfo（TS 增量缓存）避免类型信息不更新导致构建失败
RUN npx prisma generate && rm -rf .next node_modules/.cache tsconfig.tsbuildinfo && DATABASE_URL=file:/tmp/lab-build.db npm run build -- --webpack

# ───────────── 运行阶段 ─────────────
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Next.js standalone 产物（自带最小 node_modules）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
# 运行时数据目录（SQLite 持久卷挂载点）
RUN mkdir -p /app/data
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs \
    && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]
