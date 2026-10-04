import { apiFetch } from '@/lib/api-client'
import type { Catalog } from '@/features/selection/types'

export async function getCatalogOptions() {
  return (await apiFetch<{ code: number; data: Catalog }>('/api/v1/client/catalog/options')).data
}
