import { apiFetch } from '@/lib/api-client';

export interface ThemeModel {
  /** Admin-managed model id; listed in fallback order, the first one prices the offer. */
  id: string;
  /** Provider-side model id, shown as the model label. */
  model: string;
  unitCredits: number;
  revision: number;
}

export async function getThemeModels(): Promise<ThemeModel[]> {
  const response = await apiFetch<{ code: number; data: ThemeModel[] }>('/api/v1/client/theme-models');
  return response.data;
}
