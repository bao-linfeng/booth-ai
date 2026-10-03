import type pg from 'pg';
import type { Config } from '../../../config.js';
import type { createStorage } from '../../../infra/storage.js';
import type { Logger } from '../../../infra/logger.js';
import type { ArtworkSnapshot } from './service.js';

export type ArtworkConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
export type ArtworkStorage = ReturnType<typeof createStorage>;
export type PublishArtworkEvent = (jobId: string, event: unknown) => Promise<void>;
export type ArtworkJob = {
  requestId: string | null;
  schemeCode: string;
  unitCredits: number | null;
  userId: string;
  status: string;
  snapshot: ArtworkSnapshot | null;
};

/** 一次已持有租约的画稿任务执行上下文，供各阶段共用。 */
export type ArtworkRun = {
  database: pg.Pool;
  jobId: string;
  job: ArtworkJob;
  lease: string;
  deadline: Date;
  config: ArtworkConfig;
  storage: ArtworkStorage;
  log: Logger;
  publish: PublishArtworkEvent;
};
