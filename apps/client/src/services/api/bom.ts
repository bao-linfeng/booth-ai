import { apiFetch } from '@/lib/api-client'

export interface ClientBomItem {
  id: string;
  ordinal: number;
  productName: string;
  productModel: string | null;
  specificationMm: string | null;
  quantity: string;
  sourceUnit: string;
  erpCode: string | null;
  totalWeightKg: string | null;
  measurementKind: 'count' | 'length' | 'area';
}

export interface ClientBomResponse {
  schemeCode: string;
  revision: number;
  status: 'verified';
  verifiedAt: string;
  items: ClientBomItem[];
}

export async function getClientBom(schemeCode: string): Promise<ClientBomResponse> {
  const response = await apiFetch<{ code: number; data: ClientBomResponse }>(
    `/api/v1/client/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials`,
  )
  return response.data
}

export async function downloadClientBom(schemeCode: string, revision: number): Promise<Blob> {
  const response = await apiFetch.raw<Blob, 'blob'>(
    `/api/v1/client/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/download`,
    { query: { revision }, responseType: 'blob', timeout: 120000, retry: 0 },
  )
  const contentType = response.headers.get('content-type') ?? ''
  if (!response._data?.size || (!contentType.includes('spreadsheetml') && !contentType.includes('spreadsheet'))) {
    throw new Error('Invalid BOM download')
  }
  return response._data
}
