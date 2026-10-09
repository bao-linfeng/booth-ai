import { requestClient } from '#/api/request';

export interface SchemeAssetCounts {
  model: number;
  rendering: number;
  mask: number;
  drawing: number;
  artwork: number;
}

export interface SchemeLatestReview {
  phase: 'asset_verification' | 'overall';
  decision: 'pass' | 'reject';
  notes: null | string;
  createdAt: string;
}

export interface SchemeRecord {
  id: string;
  code: string;
  name: string;
  parentCode: null | string;
  lengthMm: null | number;
  widthMm: null | number;
  heightMm: null | number;
  areaM2: null | string;
  openingCount: null | number;
  productSystemId: null | string;
  styleId: null | string;
  industryIds: string[];
  budgetTierId: null | string;
  zoneIds: string[];
  featureIds: string[];
  description: null | string;
  keywords: string[];
  source: null | string;
  visualTheme: null | string;
  publishStatus: 'draft' | 'published' | 'unpublished';
  verificationStatus: 'failed' | 'unverified' | 'verified';
  notes: null | string;
  editRevision: number;
  createdAt: string;
  updatedAt: string;
  // 运营信息（列表接口聚合返回）
  assetCounts: null | SchemeAssetCounts;
  latestReview: null | SchemeLatestReview;
  lastUnpublishReason: null | string;
}

export interface SchemeListParams {
  page?: number;
  pageSize?: number;
  /** 编号或名称包含该关键词 */
  keyword?: string;
  code?: string;
  name?: string;
  styleId?: string;
  industryId?: string;
  productSystemId?: string;
  publishStatus?: string;
  verificationStatus?: string;
  openingCount?: number;
  budgetTierId?: string;
  zoneIds?: string[];
  featureIds?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface SchemeListResult {
  data: SchemeRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSchemeInput {
  code: string;
  name: string;
  parentCode?: null | string;
  description?: null | string;
  lengthMm?: null | number;
  widthMm?: null | number;
  heightMm?: null | number;
  areaM2?: null | number;
  openingCount?: null | number;
  productSystemId?: null | string;
  styleId?: null | string;
  industryIds?: string[];
  budgetTierId?: null | string;
  keywords?: string[];
  notes?: null | string;
  zoneIds?: string[];
  featureIds?: string[];
  source?: null | string;
}

export interface UpdateSchemeInput extends Partial<
  Omit<CreateSchemeInput, 'code'>
> {
  editRevision: number;
}

export type SchemeOptionsResult = Record<
  string,
  { id: string; label: string; itemValue: string }[]
>;

export async function getSchemeListApi(params?: SchemeListParams) {
  return requestClient.get<SchemeListResult>('/v1/admin/schemes', { params });
}

export async function getSchemeDetailApi(code: string) {
  return requestClient.get<SchemeRecord>(
    `/v1/admin/schemes/${encodeURIComponent(code)}`,
  );
}

export async function createSchemeApi(data: CreateSchemeInput) {
  return requestClient.post<SchemeRecord>('/v1/admin/schemes', data);
}

export async function updateSchemeApi(code: string, data: UpdateSchemeInput) {
  return requestClient.request<SchemeRecord>(
    `/v1/admin/schemes/${encodeURIComponent(code)}`,
    {
      method: 'PUT',
      data,
    },
  );
}

export async function getSchemeOptionsApi() {
  return requestClient.get<SchemeOptionsResult>('/v1/admin/schemes/options');
}

export async function deleteSchemeApi(code: string) {
  return requestClient.delete<null>(
    `/v1/admin/schemes/${encodeURIComponent(code)}`,
  );
}

export interface ImportPreviewRow {
  rowNumber: number;
  code: string;
  name: string;
  status: 'duplicate' | 'error' | 'valid';
  reason?: string;
}

export interface ImportPreviewSummary {
  total: number;
  valid: number;
  duplicate: number;
  error: number;
  skipped: number;
}

export interface ImportPreviewResult {
  importId: string;
  rows: ImportPreviewRow[];
  summary: ImportPreviewSummary;
}

export interface ImportCommitResult {
  created: number;
  updated: number;
  dictionaryItemsCreated: number;
  failed: { rowNumber: number; code: string; reason: string }[];
}

export async function previewImportApi(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return requestClient.post<ImportPreviewResult>(
    '/v1/admin/scheme-imports',
    formData,
  );
}

export async function commitImportApi(
  importId: string,
  duplicateStrategy: 'skip' | 'update',
) {
  return requestClient.post<ImportCommitResult>(
    `/v1/admin/scheme-imports/${importId}/commit`,
    {
      duplicateStrategy,
    },
  );
}
