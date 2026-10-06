/**
 * 生成生产环境所需强随机密钥
 *
 * 用法：npx tsx scripts/gen-secrets.ts
 * 将输出的两行复制到服务器 .env 文件的 JWT_SECRET / CREDENTIAL_ENCRYPTION_KEY
 */
import { randomBytes } from 'node:crypto';

const jwtSecret = randomBytes(48).toString('base64url');
const encryptionKey = randomBytes(32).toString('base64url');

console.log('===== 生产环境密钥（复制到 .env）=====');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`CREDENTIAL_ENCRYPTION_KEY=${encryptionKey}`);
console.log('======================================');
console.log('请妥善保管，切勿提交到 git 或泄露。');
