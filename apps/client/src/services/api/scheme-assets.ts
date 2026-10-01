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
  revision: string;
  items: SchemeDeliverable[];
}

export async function downloadSchemeArchive(code: string, type: SchemeAssetType, revision: string): Promise<Blob> {
  const response = await apiFetch.raw<Blob, 'blob'>(
    `/api/v1/client/schemes/${encodeURIComponent(code)}/${type}/download`,
    { query: { revision }, responseType: 'blob', timeout: 120000, retry: 0 },
  );
  if (!response.headers.get('content-type')?.includes('application/zip') || !response._data?.size) {
    throw new Error('Invalid archive response');
  }
  return response._data;
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
