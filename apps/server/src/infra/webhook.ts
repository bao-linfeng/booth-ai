import { createHmac } from 'node:crypto';

export class WebhookDeliveryError extends Error {
  constructor(public readonly code: 'NOTIFICATION_REJECTED' | 'NOTIFICATION_UNAVAILABLE') {
    super(code);
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
// Worst case for one delivery with the default timeout, used to keep a batch inside its claim lease.
export const WEBHOOK_MAX_SEND_MS = DEFAULT_TIMEOUT_MS + 5_000;

export interface WebhookMessage {
  id: string;
  body: unknown;
}

// Receivers verify `sha256=HMAC(secret, "<timestamp>.<body>")` and de-duplicate on the event id header.
export function createWebhookSender(options: { url: string; secret: string; timeoutMs?: number }, fetcher: typeof fetch = fetch) {
  return async (message: WebhookMessage): Promise<void> => {
    const body = JSON.stringify(message.body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', options.secret).update(`${timestamp}.${body}`).digest('hex');
    let response: Response;
    try {
      response = await fetcher(options.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        body,
        headers: {
          'content-type': 'application/json',
          'x-booth-event-id': message.id,
          'x-booth-timestamp': timestamp,
          'x-booth-signature': `sha256=${signature}`,
        },
      });
    } catch {
      throw new WebhookDeliveryError('NOTIFICATION_UNAVAILABLE');
    }
    await response.body?.cancel().catch(() => {});
    if (!response.ok)
      throw new WebhookDeliveryError(
        response.status >= 500 || response.status === 408 || response.status === 429 ? 'NOTIFICATION_UNAVAILABLE' : 'NOTIFICATION_REJECTED',
      );
  };
}
