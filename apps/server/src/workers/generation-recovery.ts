import type pg from 'pg';
import type { Queue } from 'bullmq';
import { errorCode } from '../infra/logger.js';
import { settleArtworkJob } from '../modules/generation/artwork/execution.js';
import { settleThemeJob } from '../modules/generation/theme/execution.js';
import { enqueueGenerationJob, type GenerationKind, type PublishGenerationEvent } from './generation-outbox.js';

export type RecoveryAction = 'enqueue' | 'retry' | 'settle' | 'wait';
export type RecoveryQueues = Record<GenerationKind, Pick<Queue, 'getJob' | 'add'>>;

export interface RecoveryCandidate {
  status: string;
  /** 运行中任务已过执行截止时间（无截止时间时按最后更新 30 分钟计）。 */
  expired: boolean;
}

export interface RecoveryReport {
  enqueued: number;
  retried: number;
  settled: number;
  errors: { kind: GenerationKind; id: string; code: string }[];
}

/**
 * 恢复矩阵：数据库任务状态 × 队列状态 × 租约/截止时间 → 动作。主题与画稿共用同一套语义。
 * 候选已由查询保证：未完成、租约已失效，且 15 分钟无进展或已过执行截止时间。
 *
 * | 数据库状态       | 截止时间 | 队列状态                         | 动作    |
 * |------------------|----------|----------------------------------|---------|
 * | running/settling | 已过     | 任意（不查询）                   | settle  |
 * | 任意未完成       | 未过     | 不存在（Redis 丢任务/记录已过期）| enqueue |
 * | pending/queued   | —        | failed（认领前已耗尽重试）       | settle  |
 * | running/settling | 未过     | failed（如租约争用导致重试耗尽） | retry   |
 * | 任意未完成       | 未过     | completed（处理器未推进任务）    | retry   |
 * | 任意未完成       | 未过     | waiting/active/delayed 等        | wait    |
 *
 * pending/queued 遇到 failed 时结算而不是重试：任务从未被认领，没有执行截止时间约束，
 * 重试可能无限循环并长期冻结积分；结算结果与 Worker failed 事件处理器一致。
 */
export function decideRecovery(candidate: RecoveryCandidate, queueState: string | undefined): RecoveryAction {
  if (candidate.expired) return 'settle';
  if (queueState === undefined) return 'enqueue';
  if (queueState === 'failed') return candidate.status === 'pending' || candidate.status === 'queued' ? 'settle' : 'retry';
  if (queueState === 'completed') return 'retry';
  return 'wait';
}

export async function recoverGenerationJobs(
  database: pg.Pool,
  queues: RecoveryQueues,
  publish: Partial<Record<GenerationKind, PublishGenerationEvent>> = {},
): Promise<RecoveryReport> {
  const report: RecoveryReport = { enqueued: 0, retried: 0, settled: 0, errors: [] };
  for (const kind of ['theme', 'artwork'] as const) {
    const candidates = await database.query<{ id: string } & RecoveryCandidate>(`SELECT id, status::text AS status,
      status IN ('running', 'settling') AND COALESCE(execution_deadline, updated_at + interval '30 minutes') <= now() AS expired
      FROM ${kind}_jobs
      WHERE status IN ('pending', 'queued', 'running', 'settling') AND (lease_until IS NULL OR lease_until < now())
      AND (updated_at < now() - interval '15 minutes' OR (status IN ('running', 'settling') AND execution_deadline <= now()))
      ORDER BY updated_at, id LIMIT 100`);
    for (const candidate of candidates.rows) {
      // Isolate per-candidate failures so one broken job cannot stall recovery of the rest.
      try {
        const existing = candidate.expired ? undefined : await queues[kind].getJob(candidate.id);
        const state = existing ? await existing.getState() : undefined;
        const action = decideRecovery(candidate, state);
        if (action === 'settle') {
          if (kind === 'theme') await settleThemeJob(database, candidate.id, undefined, publish.theme);
          else await settleArtworkJob(database, candidate.id, undefined, publish.artwork);
          report.settled++;
        } else if (action === 'retry') {
          await existing!.retry(state as 'completed' | 'failed');
          report.retried++;
        } else if (action === 'enqueue') {
          await enqueueGenerationJob(queues[kind], kind, candidate.id);
          report.enqueued++;
        }
      } catch (error) {
        report.errors.push({ kind, id: candidate.id, code: errorCode(error) });
      }
    }
  }
  return report;
}
