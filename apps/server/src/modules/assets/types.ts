export type AssetType = 'model' | 'checklist' | 'rendering' | 'mask' | 'drawing' | 'artwork';

export interface AssetVersion {
  id: string;
  assetId: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  widthPx: number | null;
  heightPx: number | null;
  pageCount: number | null;
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
  relatedAssetId: string | null;
  metadata: Record<string, unknown>;
  isActive: boolean;
  revision: number;
  currentVersion: AssetVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAssetsOptions {
  allowedTypes?: AssetType[];
  page: number;
  pageSize: number;
  type?: AssetType;
  schemeCode?: string;
  schemeName?: string;
}

export interface CreateAssetInput {
  schemeCode: string;
  type: AssetType;
  name: string;
  sortOrder?: number;
  relatedAssetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UploadVersionInput {
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  widthPx?: number | null;
  heightPx?: number | null;
  pageCount?: number | null;
}

export interface DeleteAssetOptions {
  /** 删除效果图时一并删除其配对蒙版；未设置且存在配对蒙版时拒绝删除。 */
  withPairedMasks?: boolean;
}

export interface UpdateAssetInput {
  name?: string;
  sortOrder?: number;
  relatedAssetId?: string | null;
  metadata?: Record<string, unknown>;
}
