import { lingtongFetch } from '@/lib/api-client'
import type { LtResponse } from '@/services/types/response.type'

export interface LanguageItem {
  code: string
  name: string
  description: string
  orderIndex: number
}

export async function getLanguageList() {
  return lingtongFetch<LtResponse<LanguageItem[]>>('/api/language/list', {
    method: 'GET',
  })
}
