import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { AppError, ErrorCategory } from '@/lib/errors';

function blockedIpv4(address: string): boolean {
  const [a,b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
function blockedIpv6(address: string): boolean {
  const value=address.toLowerCase();
  if(value==='::'||value==='::1'||value.startsWith('fe80:')||value.startsWith('fc')||value.startsWith('fd')) return true;
  const mapped=value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); return mapped ? blockedIpv4(mapped[1]) : false;
}
export function isBlockedAddress(address:string):boolean { const kind=isIP(address); return kind===4?blockedIpv4(address):kind===6?blockedIpv6(address):true; }

/** 在保存配置和每次请求前都校验，缓解 DNS rebinding 与内网元数据 SSRF。 */
export async function assertSafeExternalUrl(input:string|URL):Promise<URL>{
  let url:URL; try{url=new URL(input)}catch{throw new AppError(ErrorCategory.VALIDATION_ERROR,'上游地址格式无效',{httpStatus:400})}
  if(url.protocol!=='https:') throw new AppError(ErrorCategory.VALIDATION_ERROR,'上游地址必须使用 HTTPS',{httpStatus:400});
  if(url.username||url.password) throw new AppError(ErrorCategory.VALIDATION_ERROR,'上游地址不得包含用户名或密码',{httpStatus:400});
  if(url.port && url.port!=='443') throw new AppError(ErrorCategory.VALIDATION_ERROR,'上游地址仅允许 HTTPS 443 端口',{httpStatus:400});
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='metadata.google.internal') throw new AppError(ErrorCategory.FORBIDDEN,'禁止访问本机或内网地址',{httpStatus:403});
  const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true,verbatim:true}).catch(()=>{throw new AppError(ErrorCategory.VALIDATION_ERROR,'上游域名无法解析',{httpStatus:400})});
  if(addresses.length===0||addresses.some(item=>isBlockedAddress(item.address))) throw new AppError(ErrorCategory.FORBIDDEN,'禁止访问本机、内网或保留地址',{httpStatus:403});
  return url;
}
