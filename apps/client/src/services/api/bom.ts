import { apiFetch } from '@/lib/api-client';

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

export async function getClientBomApi(schemeCode: string): Promise<ClientBomResponse> {
  const res = await apiFetch<ClientBomResponse>(
    `/api/v1/client/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials`
  );
  return res;
}

export async function downloadClientBomApi(schemeCode: string, revision: number): Promise<Response> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const url = `${baseUrl}/api/v1/client/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/download?revision=${revision}`;
  return fetch(url);
}
