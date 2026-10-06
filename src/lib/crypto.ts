/**
 * 凭证加密模块 — AES-256-GCM
 *
 * 用于加密存储 ApiCredential.apiKey（LLM / OCR 密钥），避免数据库泄露后密钥明文暴露。
 * 主密钥从环境变量 CREDENTIAL_ENCRYPTION_KEY 读取；未配置时回退到一个开发态固定密钥
 * （仅在 NODE_ENV !== production 时允许，生产环境缺失密钥将抛错）。
 */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM 推荐 12 字节 IV
const TAG_LEN = 16;
const SALT = 'lab-safety-credential-salt-v1'; // 固定 salt（密钥派生用，非密码哈希）

/** 派生 32 字节主密钥 */
function getMasterKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '生产环境必须配置 CREDENTIAL_ENCRYPTION_KEY 环境变量（32 字节随机串，建议 `openssl rand -hex 32`）'
      );
    }
    // 开发态回退：明确标记为不安全，仅用于本地
    return scryptSync('dev-insecure-key-do-not-use-in-prod', SALT, 32);
  }
  // 若已是 64 位 hex（32 字节）直接用；否则通过 scrypt 派生到 32 字节
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return scryptSync(raw, SALT, 32);
}

let cachedKey: Buffer | null = null;
function masterKey(): Buffer {
  if (!cachedKey) cachedKey = getMasterKey();
  return cachedKey;
}

/** 加密明文，返回 `enc:v1:<base64(iv|ciphertext|tag)>` */
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ciphertext, tag]).toString('base64');
  return `enc:v1:${blob}`;
}

/**
 * 解密 `enc:v1:...` 密文。
 * 兼容旧明文：若输入不是加密格式，原样返回（便于平滑迁移历史明文数据）。
 */
export function decryptCredential(stored: string): string {
  if (!stored || !stored.startsWith('enc:v1:')) {
    // 旧明文数据，原样返回（读取时透明兼容）
    return stored;
  }
  const blob = stored.slice('enc:v1:'.length);
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('凭证密文格式损坏');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** 判断某值是否已加密 */
export function isEncrypted(stored: string): boolean {
  return !!stored && stored.startsWith('enc:v1:');
}

/** 个人敏感信息（如手机号）使用同一主密钥加密，调用方不得写入快照或日志。 */
export const encryptPersonalData = encryptCredential;
export const decryptPersonalData = decryptCredential;
