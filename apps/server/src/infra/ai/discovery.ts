import { assertPublicEndpoint, EndpointError } from './endpoint.js';

export type DiscoveryFailure = 'ENDPOINT_INVALID' | 'AUTH_FAILED' | 'TIMEOUT' | 'UNREACHABLE' | 'BAD_RESPONSE';

/** Model listing failures carry a coarse reason only; provider response bodies may echo credentials. */
export class ModelDiscoveryError extends Error {
  constructor(public readonly reason: DiscoveryFailure) {
    super(reason);
  }
}

const MAX_LISTING_BYTES = 4 * 1024 * 1024;
// Slow relays and cross-border routes can take tens of seconds; the admin UI waits a little longer to receive the reason.
const LISTING_TIMEOUT_MS = 60_000;

export async function fetchModelListing(baseUrl: string, path: string, headers: Record<string, string>): Promise<unknown> {
  try {
    await assertPublicEndpoint(baseUrl);
  } catch (error) {
    throw new ModelDiscoveryError(error instanceof EndpointError ? 'ENDPOINT_INVALID' : 'UNREACHABLE');
  }
  let response: Response;
  const signal = AbortSignal.timeout(LISTING_TIMEOUT_MS);
  try {
    response = await fetch(`${baseUrl}${path}`, { headers, redirect: 'error', signal });
  } catch (error) {
    const timedOut =
      signal.aborted ||
      (error instanceof Error &&
        (error.name === 'TimeoutError' || (error.cause as { code?: string } | undefined)?.code === 'UND_ERR_CONNECT_TIMEOUT'));
    throw new ModelDiscoveryError(timedOut ? 'TIMEOUT' : 'UNREACHABLE');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ModelDiscoveryError(response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'BAD_RESPONSE');
  }
  try {
    const text = await response.text();
    if (text.length > MAX_LISTING_BYTES) throw new Error('too large');
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ModelDiscoveryError(signal.aborted || (error instanceof Error && error.name === 'TimeoutError') ? 'TIMEOUT' : 'BAD_RESPONSE');
  }
}
