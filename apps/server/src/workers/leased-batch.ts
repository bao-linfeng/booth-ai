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
