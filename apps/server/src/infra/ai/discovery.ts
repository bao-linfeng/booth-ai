import { assertPublicEndpoint, EndpointError } from './endpoint.js';

export type DiscoveryFailure = 'ENDPOINT_INVALID' | 'AUTH_FAILED' | 'UNREACHABLE' | 'BAD_RESPONSE';

/** Model listing failures carry a coarse reason only; provider response bodies may echo credentials. */
export class ModelDiscoveryError extends Error {
  constructor(public readonly reason: DiscoveryFailure) { super(reason); }
}

const MAX_LISTING_BYTES = 4 * 1024 * 1024;

export async function fetchModelListing(baseUrl: string, path: string, headers: Record<string, string>): Promise<unknown> {
  try { await assertPublicEndpoint(baseUrl); } catch (error) {
    throw new ModelDiscoveryError(error instanceof EndpointError ? 'ENDPOINT_INVALID' : 'UNREACHABLE');
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { throw new ModelDiscoveryError('UNREACHABLE'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ModelDiscoveryError(response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'BAD_RESPONSE');
  }
  try {
    const text = await response.text();
    if (text.length > MAX_LISTING_BYTES) throw new Error('too large');
    return JSON.parse(text) as unknown;
  } catch { throw new ModelDiscoveryError('BAD_RESPONSE'); }
}
