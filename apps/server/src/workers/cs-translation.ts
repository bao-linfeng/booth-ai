import type { Queue } from 'bullmq';
import type pg from 'pg';
import { CS_TRANSLATE_TASK_NAME } from '../infra/queue.js';
import { claimPendingTranslations } from '../modules/customer-service/translation.js';

/** 认领 pending 译文并投递到 booth-cs；完成或失败后移除任务，超时重投时不会被 jobId 去重吞掉 */
export async function dispatchCsTranslations(database: Pick<pg.Pool, 'query'>, queue: Pick<Queue, 'add'>): Promise<number> {
  const claimed = await claimPendingTranslations(database);
  for (const item of claimed) {
    await queue.add(CS_TRANSLATE_TASK_NAME, item, {
      jobId: `cs-translate-${item.messageId}-${item.locale}`, attempts: 3, removeOnComplete: true, removeOnFail: true,
    });
  }
  return claimed.length;
}
