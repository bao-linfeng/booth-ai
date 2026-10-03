import type pg from 'pg';
import type { Config } from '../../../config.js';
import type { AssignedAiModel } from '../../../infra/ai/types.js';
import type { createStorage } from '../../../infra/storage.js';
import type { Logger } from '../../../infra/logger.js';
import type { ThemeInput } from '../theme/service.js';

export const DIRECTIONS = ['front', 'back', 'left', 'right'] as const;
export type Direction = typeof DIRECTIONS[number];
export const DIRECTION_LABELS: Record<Direction, string> = { front: '正面', back: '背面', left: '左侧', right: '右侧' };
export const ARTWORK_QUALITY = { minLongEdge: 1536, minShortEdge: 1024, maxPixels: 40_000_000, maxBytes: 30 * 1024 * 1024 };

export type ArtworkContext = { schemeCode: string; themeJobId: string; resultId: string; selectionRevision: number };
export type Database = Pick<pg.Pool, 'query'>;
export type ArtworkSnapshot = {
  source: { assetId: string; versionId: string; objectKey: string; checksum: string };
  input: ThemeInput; prompt: string; template: { id: string; revision: number; body: string } | null;
  directionPrompts?: Record<Direction, string>;
  model: Pick<AssignedAiModel, 'id' | 'model' | 'revision' | 'unitCredits'>;
  quality: typeof ARTWORK_QUALITY; pipelineRevision: number;
};
export type ArtworkOffer = ArtworkContext & { userId: string; snapshot: ArtworkSnapshot; unitCredits: number; expiresAt: string };
export type JobSummary = { id: string; status: string; deliveryStatus: string; unitCredits: number | null; usableCount: number; requestHash: string };

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
