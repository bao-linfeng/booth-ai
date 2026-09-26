import { requestClient } from '#/api/request';

export interface SchemeRecord {
  id: string;
  code: string;
  name: string;
  parentCode: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  areaSqm: number | null;
  openingCount: number | null;
  openingDirections: string[];
  productLine: string | null;
  style: string | null;
  industries: string[];
  budgetTier: string | null;
  functionalZones: string[];
  keyFeatures: string[];
  description: string | null;
  keywords: string[];
  source: string | null;
  visualTheme: string | null;
  applicableConditions: Record<string, unknown> | null;
  publishStatus: 'draft' | 'published' | 'unpublished';
  verificationStatus: 'unverified' | 'verified' | 'failed';
  notes: string | null;
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
  parentCode?: string | null;
  description?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  areaSqm?: number | null;
  openingCount?: number | null;
  productLine?: string | null;
  style?: string | null;
  industries?: string[];
  budgetTier?: string | null;
  keywords?: string[];
  notes?: string | null;
  openingDirections?: string[];
  functionalZones?: string[];
  keyFeatures?: string[];
  source?: string | null;
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
  return requestClient.get<SchemeRecord>(`/v1/admin/schemes/${encodeURIComponent(code)}`);
}

export async function createSchemeApi(data: CreateSchemeInput) {
  return requestClient.post<SchemeRecord>('/v1/admin/schemes', data);
}

export async function updateSchemeApi(code: string, data: UpdateSchemeInput) {
  return requestClient.request<SchemeRecord>('/v1/admin/schemes/' + encodeURIComponent(code), {
    method: 'PATCH',
    data,
  });
}

export async function getCatalogOptionsApi(types?: string) {
  return requestClient.get<CatalogOptionsResult>('/v1/admin/catalog-options', {
    params: types ? { types } : undefined,
  });
}

export async function deleteSchemeApi(code: string) {
  return requestClient.delete<void>(`/v1/admin/schemes/${encodeURIComponent(code)}`);
}

export async function updateCatalogOptionsByTypeApi(type: string, options: CatalogOption[]) {
  return requestClient.put<{ message: string }>(`/v1/admin/catalog-options/${encodeURIComponent(type)}`, { options });
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; code: string; reason: string }[];
}

export async function importSchemesApi(file: File) {
  return requestClient.upload<ImportResult>('/v1/admin/scheme-imports', { file });
}
