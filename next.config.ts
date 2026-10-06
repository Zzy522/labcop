import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function sourceFingerprint() {
  const digest = createHash('sha256');
  function add(name: string) {
    for (const item of readdirSync(name, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(name, item.name);
      if (file.replaceAll('\\', '/') === 'src/generated' || item.name === '__pycache__' || /\.db(?:[-.].*)?$/.test(item.name)) continue;
      if (item.isDirectory()) add(file);
      else { digest.update(file.replaceAll('\\', '/')); digest.update(readFileSync(file)); }
    }
  }
  for (const folder of ['src', 'prisma', 'scripts']) add(folder);
  for (const file of ['package.json', 'package-lock.json', 'next.config.ts', 'Dockerfile']) { digest.update(file); digest.update(readFileSync(file)); }
  return digest.digest('hex');
}

function releaseVersion() {
  if (process.env.APP_RELEASE && process.env.APP_RELEASE !== 'unversioned') return process.env.APP_RELEASE;
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return `${sha}${dirty ? `-dirty-${sourceFingerprint()}` : ""}`;
  } catch { return `source-${sourceFingerprint()}`; }
}


/**
 * 安全响应头（生产/开发均下发，浏览器在 HTTP 下会忽略部分如 HSTS）
 * CSP 采用相对宽松策略：脚本限同源+inline（Next 内联脚本需要），连接限同源+https
 * 上线后可根据实际加载情况逐步收紧 script-src（改用 nonce）
 *
 * 注意：frame-ancestors / X-Frame-Options 必须允许同源 framing，
 * 因为化合物绘制器（Ketcher）通过同源 iframe（/ketcher/index.html）加载。
 * 设为 SAMEORIGIN / 'self'：仅允许同源页面嵌入，仍可防止跨站点击劫持。
 */
const createSecurityHeaders = (allowKetcherEval = false) => [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' || allowKetcherEval ? " 'unsafe-eval'" : ''}`,
      // Ketcher standalone 2.x creates the Indigo converter as a blob Worker.
      // Without this directive CSP falls back to default-src and silently blocks it.
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      //"upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig = (): NextConfig => ({
  env: { APP_RELEASE: releaseVersion() },
  // RDKit's Node build resolves its WASM file relative to the package directory.
  // Keep it external so standalone output traces both the JS loader and .wasm asset.
  serverExternalPackages: ["@rdkit/rdkit"],
  // 输出独立可运行产物（自带最小 node_modules），适配 Docker 部署
  output: "standalone",
  outputFileTracingIncludes: {
    '/api/assistant/structure': ['./node_modules/@rdkit/rdkit/dist/**/*'],
    '/api/assistant/attachments': [
      './scripts/document-reader.mjs',
      './node_modules/{fflate,fast-xml-parser,fast-xml-builder,path-expression-matcher,xml-naming,strnum,is-unsafe,pdfjs-dist}/**/*',
      './node_modules/@nodable/entities/**/*',
      './node_modules/@napi-rs/canvas*/**/*',
    ],
  },
  // 允许 ngrok 内网穿透域名访问 dev server（仅开发）
  allowedDevOrigins: ["quake-thinning-tuesday.ngrok-free.dev", "127.0.0.1", "localhost"],
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    const securityHeaders = createSecurityHeaders();
    return [
      {
        // Ketcher / RDKit 的带版本静态资源体积较大，长期缓存可显著加快再次打开绘图器与计算器。
        source: "/ketcher/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/rdkit/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // The bundled Ketcher 2.6.3 Indigo converter uses dynamic JS in its worker.
        // Scope that legacy requirement to its iframe document; the app stays strict.
        source: "/ketcher/index.html",
        headers: createSecurityHeaders(true),
      },
    ];
  },
});

export default nextConfig;
