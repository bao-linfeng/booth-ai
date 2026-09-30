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
  createdAt: string;
  updatedAt: string;
  durationMs: number;
}

export interface GenerationJobDetail extends GenerationJob {
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
