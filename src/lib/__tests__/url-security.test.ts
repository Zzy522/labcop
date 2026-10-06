import { describe, expect, it } from 'vitest';
import { assertSafeExternalUrl, isBlockedAddress } from '@/lib/url-security';

describe('SSRF 出站地址保护', () => {
  it.each(['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','fe80::1'])('阻断私网或保留地址 %s', (address) => expect(isBlockedAddress(address)).toBe(true));
  it('拒绝非 HTTPS 协议', async () => { await expect(assertSafeExternalUrl('http://8.8.8.8/api')).rejects.toThrow('HTTPS'); });
  it('拒绝云元数据地址', async () => { await expect(assertSafeExternalUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow('禁止访问'); });
  it('拒绝携带凭证的 URL', async () => { await expect(assertSafeExternalUrl('https://user:pass@8.8.8.8/api')).rejects.toThrow('用户名或密码'); });
});
