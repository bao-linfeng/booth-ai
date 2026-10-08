import type pg from 'pg';
import type { Config } from '../../../config.js';
import type { createStorage } from '../../../infra/storage.js';
import type { Logger } from '../../../infra/logger.js';
import type { GenerationSnapshot, ThemeInput } from './service.js';

export type ThemeConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
export type ThemeStorage = ReturnType<typeof createStorage>;
export type ThemeJob = { requestId: string | null; requestedCount: number; sourceAssetId: string; schemeCode: string; input: ThemeInput; unitCredits: number | null; userId: string; status: string; snapshot: GenerationSnapshot | null };
export type PublishThemeEvent = (jobId: string, event: unknown) => Promise<void>;

/** 一次已持有租约的主题任务执行上下文，供各阶段共用。 */
export type ThemeRun = {
  database: pg.Pool;
  jobId: string;
  job: ThemeJob;
  lease: string;
  deadline: Date;
  config: ThemeConfig;
  storage: ThemeStorage;
  log: Logger;
  /** Aborted when the worker shuts down; checked only before new provider calls. */
  draining?: AbortSignal;
};
