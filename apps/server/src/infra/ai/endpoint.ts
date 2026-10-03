import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

// Official API hosts are trusted as-is; any other admin-supplied host must resolve to public addresses only.
const OFFICIAL_HOSTS = new Set(['api.openai.com', 'generativelanguage.googleapis.com', 'dashscope.aliyuncs.com', 'api.deepseek.com']);

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export class EndpointError extends Error {
  constructor(message: string) { super(message); }
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  const family = isIP(address);
  return family === 0 || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Normalizes an admin-supplied base URL; rejects anything but public HTTPS origins with an optional path. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new EndpointError('Base URL must be an absolute URL'); }
  if (url.protocol !== 'https:') throw new EndpointError('Base URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new EndpointError('Base URL must not contain credentials, query or fragment');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes('.') && !isIP(host)) {
    throw new EndpointError('Base URL must point to a public host');
  }
  if (isIP(host) && isPrivateAddress(host)) throw new EndpointError('Base URL must point to a public host');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Re-checks DNS right before a request so a public name later pointed at an internal address is refused. */
export async function assertPublicEndpoint(baseUrl: string): Promise<void> {
  const host = new URL(normalizeBaseUrl(baseUrl)).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (OFFICIAL_HOSTS.has(host) || isIP(host)) return;
  let addresses: { address: string }[];
  try { addresses = await dns.promises.lookup(host, { all: true }); } catch { throw new EndpointError('Base URL host cannot be resolved'); }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new EndpointError('Base URL must point to a public host');
}
