/**
 * 邮件发送服务（基于 nodemailer）
 *
 * - 通过 SMTP_* 环境变量配置
 * - 未配置 SMTP_HOST 时降级为控制台打印（仅开发用），不抛错
 * - 生产必须配置 SMTP，否则邮箱验证/密码重置链接无法送达用户
 */
import nodemailer from 'nodemailer';

type MailTransporter = ReturnType<typeof nodemailer.createTransport>;

let transporter: MailTransporter | null = null;

function getTransporter(): MailTransporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
        : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    // 打印实际发件地址，便于排查 "501 mail from address must be same as authorization user" 类问题
    console.log(`[email] SMTP 已配置：host=${process.env.SMTP_HOST}:${process.env.SMTP_PORT} user=${process.env.SMTP_USER} from=${FROM}`);
  }
  return transporter;
}

/**
 * 计算发件人地址。
 *
 * 腾讯企业邮箱（exmail）等服务商强制要求：SMTP FROM 地址必须等于认证账号（SMTP_USER），
 * 否则报 "501 mail from address must be same as authorization user"。
 * 因此当 SMTP_USER 已配置时，统一用 SMTP_USER 作为发件地址；
 * 显示名从 SMTP_FROM 中提取（如 "实验室安全平台 <a@b>" → "实验室安全平台"），便于自定义品牌名。
 */
function resolveFrom(): string {
  const user = process.env.SMTP_USER;
  const rawFrom = process.env.SMTP_FROM || '';
  // 提取显示名：匹配 "显示名 <addr>" 或 显示名 <addr>
  const m = rawFrom.match(/^"?(.*?)"?\s*<[^>]+>$/);
  const displayName = (m?.[1] ?? '').trim() || '实验室安全平台';
  if (user) {
    return `${displayName} <${user}>`;
  }
  return rawFrom || `${displayName} <noreply@lab-safety.local>`;
}

const FROM = resolveFrom();
const BASE = process.env.APP_BASE_URL || 'http://localhost:3000';

/** 发送邮箱验证邮件 */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = `${BASE}/verify-email?token=${token}`;
  const t = getTransporter();
  if (!t) {
    console.log(`[email] SMTP 未配置，验证链接（仅开发）：${link}`);
    return;
  }
  await t.sendMail({
    from: FROM,
    to: email,
    subject: '【Lab Copilot Agent 平台】邮箱验证',
    html: `<div style="font-family:sans-serif;line-height:1.6"><p>您好，</p><p>请点击下方链接验证邮箱（30 分钟内有效）：</p><p><a href="${link}" style="color:#0d9488">${link}</a></p><p>如非本人操作请忽略本邮件。</p></div>`,
  });
}

/** 发送密码重置邮件 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const link = `${BASE}/reset-password?token=${token}`;
  const t = getTransporter();
  if (!t) {
    console.log(`[email] SMTP 未配置，重置链接（仅开发）：${link}`);
    return;
  }
  await t.sendMail({
    from: FROM,
    to: email,
    subject: '【Lab Copilot Agent 平台】密码重置',
    html: `<div style="font-family:sans-serif;line-height:1.6"><p>您好，</p><p>请点击下方链接重置密码（30 分钟内有效）：</p><p><a href="${link}" style="color:#0d9488">${link}</a></p><p>如非本人操作请忽略本邮件，您的密码不会被更改。</p></div>`,
  });
}

/** 发送邮箱验证码（注册时使用，6 位数字，5 分钟有效） */
export async function sendVerificationCodeEmail(email: string, code: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    // 未配置 SMTP：打印到服务器控制台，方便开发调试
    console.log(`[email] SMTP 未配置，邮箱验证码（仅开发）→ ${email}：${code}`);
    return;
  }
  await t.sendMail({
    from: FROM,
    to: email,
    subject: '【Lab Copilot Agent 平台】邮箱验证码',
    html: `<div style="font-family:sans-serif;line-height:1.6"><p>您好，</p><p>您的注册验证码为：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#0d9488">${code}</p><p>验证码 5 分钟内有效。如非本人操作请忽略本邮件。</p></div>`,
  });
}
