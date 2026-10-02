import { apiFetch } from '@/lib/api-client';

export interface ThemeModel {
  provider: string;
  /** Display name from the server model catalog. */
  label: string;
  model: string;
  unitCredits: number;
  revision: number;
}

export async function getThemeModels(): Promise<ThemeModel[]> {
  const response = await apiFetch<{ code: number; data: ThemeModel[] }>('/api/v1/client/theme-models');
  return response.data;
}
