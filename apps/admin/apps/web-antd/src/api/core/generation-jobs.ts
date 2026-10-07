import { requestClient } from '#/api/request';

export type JobType = 'artwork' | 'theme';
export type GenerationJobStatus =
  | 'failed'
  | 'partially_succeeded'
  | 'pending'
  | 'queued'
  | 'running'
  | 'settling'
  | 'succeeded';

export interface GenerationJobResult {
  direction?: 'back' | 'front' | 'left' | 'right';
  id: string;
  ordinal: number;
  assetId: string;
  previewUrl: null | string;
  width: null | number;
  height: null | number;
  createdAt: string;
}

export interface GenerationJob {
  id: string;
  jobType: JobType;
  userId: string;
  username: null | string;
  schemeCode: string;
  status: GenerationJobStatus;
  phase: null | string;
  requestedCount: number;
  usableCount: number;
  unitCredits: null | number;
  totalCreditsConsumed: null | number;
  input: {
    industryId: string;
    styleId: string;
    brandColors?: string[];
    brandKeywords?: string;
  };
  /** 积分对账无法自动修复的问题代码；修复后清空。 */
  creditIssue: null | string;
  creditIssueAt: null | string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
}

export type CreditReservationStatus = 'released' | 'reserved' | 'settled';

/** 任务的积分预占与扣费流水。 */
export interface GenerationJobCredits {
  reservation: null | {
    amount: number;
    createdAt: string;
    status: CreditReservationStatus;
    updatedAt: string;
  };
  charge: null | { amount: number; createdAt: string; id: string };
}

export interface GenerationJobDetail extends GenerationJob {
  credits: GenerationJobCredits;
  deliveryStatus?: string;
  mappingStatus?: string;
  themeSelection?: {
    themeJobId: string;
    resultId: string;
    selectionRevision: number;
  };
  directions?: { direction: string; status: string; reason: null | string }[];
  generationSnapshot?: {
    /** `id`/`name` are absent on jobs created before admin-managed models. */
    model: { id?: string; model: string; revision: number };
    prompt: string;
  };
  sourceAssetId: string;
  offerId: string;
  requestKey: string;
  cacheMode: 'refresh' | 'reuse';
  selectionRevision: number;
  isSelected: boolean;
  selectedResultId: null | string;
  industryLabel: null | string;
  styleLabel: null | string;
  sourcePreviewUrl: null | string;
  results: GenerationJobResult[];
}

export function listGenerationJobsApi(params: {
  page: number;
  pageSize: number;
  jobType?: JobType;
  status?: GenerationJobStatus;
  userId?: string;
  schemeCode?: string;
  from?: string;
  to?: string;
  creditIssue?: boolean;
}) {
  return requestClient.get<{
    data: GenerationJob[];
    total: number;
    page: number;
    pageSize: number;
  }>('/v1/admin/generation-jobs', { params });
}

export function getGenerationJobApi(jobId: string) {
  return requestClient.get<GenerationJobDetail>(
    `/v1/admin/generation-jobs/${encodeURIComponent(jobId)}`,
  );
}
