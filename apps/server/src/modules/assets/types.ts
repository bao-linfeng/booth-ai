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

export interface UpdateAssetInput {
  name?: string;
  sortOrder?: number;
  relatedAssetId?: string | null;
  metadata?: Record<string, unknown>;
}
