import { apiFetch } from '@/lib/api-client';

export type SchemeAssetType = 'drawings' | 'artworks';

export interface SchemeDeliverable {
  assetId: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
}

export interface SchemeDeliverables {
  schemeCode: string;
  items: SchemeDeliverable[];
}

interface DownloadLink {
  downloadUrl: string;
  filename: string;
  mimeType: string;
  expiresAt: string;
}

export async function getSchemeDeliverables(code: string, type: SchemeAssetType): Promise<SchemeDeliverables> {
  const result = await apiFetch<{ code: number; data: SchemeDeliverables }>(
    `/api/v1/client/schemes/${encodeURIComponent(code)}/${type}`,
  );
  return result.data;
}

export async function getSchemeDownload(code: string, type: SchemeAssetType | 'model', assetId?: string, preview = false): Promise<DownloadLink> {
  const suffix = type === 'model' ? 'model/download' : `${type}/${encodeURIComponent(assetId!)}/download`;
  const result = await apiFetch<{ code: number; data: DownloadLink }>(
    `/api/v1/client/schemes/${encodeURIComponent(code)}/${suffix}${preview ? '?disposition=preview' : ''}`,
  );
  return result.data;
}
