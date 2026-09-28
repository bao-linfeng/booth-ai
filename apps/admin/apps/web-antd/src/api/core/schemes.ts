import { requestClient } from '#/api/request';

export interface SchemeRecord {
  id: string;
  code: string;
  name: string;
  parentCode: null | string;
  lengthCm: null | number;
  widthCm: null | number;
  heightCm: null | number;
  areaSqm: null | number;
  openingCount: null | number;
  openingDirections: string[];
  productLine: null | string;
  style: null | string;
  industries: string[];
  budgetTier: null | string;
  functionalZones: string[];
  keyFeatures: string[];
  description: null | string;
  keywords: string[];
  source: null | string;
  visualTheme: null | string;
  applicableConditions: null | Record<string, unknown>;
  publishStatus: 'draft' | 'published' | 'unpublished';
  verificationStatus: 'failed' | 'unverified' | 'verified';
  notes: null | string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SchemeListParams {
  page?: number;
  pageSize?: number;
  code?: string;
  name?: string;
  style?: string;
  industry?: string;
  productLine?: string;
  publishStatus?: string;
  verificationStatus?: string;
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
  lengthCm?: null | number;
  widthCm?: null | number;
  heightCm?: null | number;
  areaSqm?: null | number;
  openingCount?: null | number;
  productLine?: null | string;
  style?: null | string;
  industries?: string[];
  budgetTier?: null | string;
  keywords?: string[];
  notes?: null | string;
  openingDirections?: string[];
  functionalZones?: string[];
  keyFeatures?: string[];
  source?: null | string;
  applicableConditions?: null | Record<string, unknown>;
}

export interface UpdateSchemeInput extends Omit<CreateSchemeInput, 'code'> {
  expectedRevision: number;
}

export interface CatalogOption {
  key: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
}

export type CatalogOptionsResult = Record<string, CatalogOption[]>;

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

export async function getCatalogOptionsApi(types?: string) {
  return requestClient.get<CatalogOptionsResult>('/v1/admin/catalog-options', {
    params: types ? { types } : undefined,
  });
}

export async function deleteSchemeApi(code: string) {
  return requestClient.delete<void>(
    `/v1/admin/schemes/${encodeURIComponent(code)}`,
  );
}

export async function updateCatalogOptionsByTypeApi(
  type: string,
  options: CatalogOption[],
) {
  return requestClient.put<{ message: string }>(
    `/v1/admin/catalog-options/${encodeURIComponent(type)}`,
    { options },
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
