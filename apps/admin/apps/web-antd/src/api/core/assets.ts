import { requestClient } from '#/api/request';

export type AssetType =
  | 'artwork'
  | 'checklist'
  | 'drawing'
  | 'mask'
  | 'model'
  | 'rendering';

export interface AssetVersion {
  id: string;
  assetId: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  widthPx: null | number;
  heightPx: null | number;
  pageCount: null | number;
  createdAt: string;
}

export interface SchemeAsset {
  id: string;
  schemeId: string;
  schemeCode: string;
  schemeName: string;
  type: AssetType;
  name: string;
  sortOrder: number;
  relatedAssetId: null | string;
  metadata: Record<string, unknown>;
  isActive: boolean;
  revision: number;
  currentVersion: AssetVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetListParams {
  page?: number;
  pageSize?: number;
  type?: AssetType;
  schemeCode?: string;
  schemeName?: string;
}

export interface AssetListResult {
  data: SchemeAsset[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UploadAssetParams {
  schemeCode: string;
  type: AssetType;
  name: string;
  sortOrder?: number;
  relatedAssetId?: string;
  metadata?: string; // JSON string
  file: File;
  /** 本次上传操作的幂等键，重试时沿用以免重复新建 */
  idempotencyKey?: string;
}

export interface UpdateAssetParams {
  name?: string;
  sortOrder?: number;
  relatedAssetId?: null | string;
  metadata?: Record<string, unknown>;
  expectedRevision: number;
}

export interface DownloadAssetResult {
  url: string;
  expiresAt: string;
}

// 跨方案资产列表（API-098）
export async function listAssetsApi(params?: AssetListParams) {
  return requestClient.get<AssetListResult>('/v1/admin/assets', { params });
}

// 单方案资产列表（API-039）
export async function listSchemeAssetsApi(
  schemeCode: string,
  type?: AssetType,
) {
  return requestClient.get<SchemeAsset[]>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets`,
    {
      params: type ? { type } : undefined,
    },
  );
}

/** 蒙版上传与改配的效果图候选；thumbnailUrl 仅在有效果图预览权限时返回 */
export interface MaskPairingCandidate {
  id: string;
  name: string;
  sortOrder: number;
  file: null | {
    heightPx: null | number;
    originalFilename: string;
    widthPx: null | number;
  };
  thumbnailUrl: null | string;
  /** 已配对该效果图的蒙版，同一效果图只能配对一个蒙版 */
  pairedMask: null | { id: string; name: string; revision: number };
}

export async function listMaskPairingCandidatesApi(schemeCode: string) {
  return requestClient.get<MaskPairingCandidate[]>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets/mask-candidates`,
  );
}

// 上传资产（API-040）
export async function uploadAssetApi(
  schemeCode: string,
  params: Omit<UploadAssetParams, 'schemeCode'>,
) {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('type', params.type);
  formData.append('name', params.name);
  if (params.sortOrder !== undefined)
    formData.append('sortOrder', String(params.sortOrder));
  if (params.relatedAssetId)
    formData.append('relatedAssetId', params.relatedAssetId);
  if (params.metadata) formData.append('metadata', params.metadata);
  if (params.idempotencyKey)
    formData.append('idempotencyKey', params.idempotencyKey);
  return requestClient.post<SchemeAsset>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets`,
    formData,
    { headers: { 'Content-Type': undefined } },
  );
}

// 替换资产文件（API-041，上传新版本）
export async function replaceAssetFileApi(
  schemeCode: string,
  assetId: string,
  file: File,
  expectedRevision: number,
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('expectedRevision', String(expectedRevision));
  return requestClient.request<AssetVersion>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets/${assetId}/versions`,
    {
      method: 'POST',
      data: formData,
      headers: { 'Content-Type': undefined },
    },
  );
}

// 更新资产元数据（API-041）
export async function updateAssetApi(
  schemeCode: string,
  assetId: string,
  params: UpdateAssetParams,
) {
  return requestClient.request<SchemeAsset>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets/${assetId}`,
    {
      method: 'PATCH',
      data: params,
    },
  );
}

// 删除资产（API-096）；删除效果图时 withPairedMasks 表示确认一并删除配对蒙版
export async function deleteAssetApi(
  schemeCode: string,
  assetId: string,
  expectedRevision: number,
  options: { withPairedMasks?: boolean } = {},
) {
  return requestClient.delete<{ revision: number }>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets/${assetId}`,
    {
      data: { expectedRevision, ...options },
    },
  );
}

// 获取下载/预览地址（API-097）
export async function getAssetDownloadUrlApi(
  schemeCode: string,
  assetId: string,
  disposition: 'attachment' | 'preview' = 'attachment',
) {
  return requestClient.get<DownloadAssetResult>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/assets/${assetId}/download`,
    {
      params: { disposition },
    },
  );
}
