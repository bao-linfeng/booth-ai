import { errorCode, type Logger } from '../infra/logger.js';
import { MailDeliveryError } from '../infra/mailer.js';

export interface LeaseBudget {
  leaseMs: number;
  // Worst-case time to handle one item, including its outcome write.
  itemMs: number;
  // Reserve for clock skew between the worker and the database that stamped the lease.
  marginMs?: number;
}

export type ItemOutcome = 'next' | 'halt';

/**
 * Handles claimed rows one by one while the claim lease still covers a worst-case item. Once it would not, or once
 * `handle` reports the channel as unavailable ('halt'), the remaining rows are handed back via `release` instead of
 * being kept until the lease expires: another replica would otherwise claim rows this batch is still sending.
 * `startedAt` must be taken before the claim so the lease is never assumed to start later than it did.
 * Returns the number of released rows.
 */
export async function processLeased<T extends { id: string }>(
  items: T[],
  options: { startedAt: number; budget: LeaseBudget; now: () => number },
  handle: (item: T) => Promise<ItemOutcome>,
  release: (ids: string[]) => Promise<void>,
): Promise<number> {
  const { startedAt, budget, now } = options;
  const deadline = startedAt + budget.leaseMs - (budget.marginMs ?? 10_000);
  for (const [index, item] of items.entries()) {
    let rest = items.slice(index);
    if (now() + budget.itemMs <= deadline) {
      if ((await handle(item)) === 'next') continue;
      rest = items.slice(index + 1);
    }
    if (rest.length) await release(rest.map(row => row.id));
    return rest.length;
  }
  return 0;
}

export interface DeliveryFailure {
  code: string;
  /** 重试无意义，直接进入终态 */
  permanent: boolean;
  /** 渠道不可达：停止本批并释放剩余条目 */
  halt: boolean;
}

/** SMTP 拒收（5xx）为永久失败；其他 SMTP 故障说明服务器暂不可达，停止本批，避免每封都等满超时 */
export function mailFailure(error: unknown): DeliveryFailure {
  const smtp = error instanceof MailDeliveryError;
  return { code: errorCode(error), permanent: smtp && error.permanent, halt: smtp && !error.permanent };
}

export const skip = Symbol('skip');

export interface LeasedDelivery<T extends { id: string; attempts: number }, P> {
  /** 日志消息前缀，如 'Receipt email' */
  name: string;
  leaseSeconds: number;
  itemMs: number;
  claim: () => Promise<T[]>;
  release: (ids: string[]) => Promise<void>;
  /** 日志上下文：只放标识与尝试次数，不放收件人 */
  context: (item: T) => Record<string, unknown>;
  /** 发送前检查，出错不计为投递失败；返回 skip 表示已就地处理（取消、顺延），不计入送达或失败 */
  prepare?: (item: T) => Promise<P | typeof skip>;
  send: (item: T, prepared: P) => Promise<void>;
  classify: (error: unknown) => DeliveryFailure;
  /** 记录失败（退避或终态），返回是否已终态 */
  fail: (item: T, failure: DeliveryFailure) => Promise<boolean>;
  complete: (item: T, prepared: P) => Promise<void>;
}

/** 领取一批并逐条投递：失败按 classify 记录并决定是否停止本批，租约不够或停止时释放剩余条目 */
export async function deliverLeased<T extends { id: string; attempts: number }, P = undefined>(
  delivery: LeasedDelivery<T, P>,
  log: Logger,
  now: () => number,
) {
  const startedAt = now();
  const claimed = await delivery.claim();
  let delivered = 0;
  let failed = 0;
  const released = await processLeased(
    claimed,
    { startedAt, now, budget: { leaseMs: delivery.leaseSeconds * 1000, itemMs: delivery.itemMs } },
    async item => {
      const prepared = delivery.prepare ? await delivery.prepare(item) : (undefined as P);
      if (prepared === skip) return 'next';
      const context = delivery.context(item);
      try {
        await delivery.send(item, prepared);
      } catch (error) {
        failed++;
        const failure = delivery.classify(error);
        const exhausted = await delivery.fail(item, failure);
        log[exhausted ? 'error' : 'warn']({ ...context, code: failure.code, exhausted }, `${delivery.name} delivery failed`);
        return failure.halt ? 'halt' : 'next';
      }
      await delivery.complete(item, prepared);
      delivered++;
      log.info(context, `${delivery.name} delivered`);
      return 'next';
    },
    ids => delivery.release(ids),
  );
  return { delivered, failed, released };
}
