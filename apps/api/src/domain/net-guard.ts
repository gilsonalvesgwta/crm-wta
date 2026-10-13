// Proteção contra uso do servidor para alcançar a rede interna (SSRF): o
// servidor SMTP de uma empresa é informado por ela, então o CRM só se conecta
// a endereços públicos e às portas de e-mail.
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) {
  blocked.addSubnet(net, bits, 'ipv6');
}

export const SMTP_PORTS = new Set([25, 465, 587, 2525]);

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

/**
 * Resolve o servidor e devolve um IP público para a conexão (a mesma
 * resolução vale para a checagem e a conexão, contra troca de DNS no meio).
 */
export async function resolvePublicHost(host: string, allowPrivate = false): Promise<string> {
  const ip = isIP(host) ? host : (await lookup(host, { verbatim: true })).address;
  if (!allowPrivate && isPrivateAddress(ip)) throw new Error('endereço interno não permitido');
  return ip;
}
