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
  // ofetch 不支持 blob responseType；用 ofetch.native 发起带认证的原始请求
  // token 注入与 apiFetch 共享同一 authStore，保持一致
  const { useAuthStore } = await import('@/stores/auth');
  const { default: pinia } = await import('@/plugins/pinia/setup');
  const authStore = useAuthStore(pinia);
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const url = `${baseUrl}/api/v1/client/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/download?revision=${revision}`;
  const headers = new Headers();
  if (authStore.token) headers.set('Authorization', `Bearer ${authStore.token}`);
  return fetch(url, { headers });
}
