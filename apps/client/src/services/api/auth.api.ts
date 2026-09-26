import { lingtongFetch } from '@/lib/api-client'
import type { LtResponse } from '@/services/types/response.type'
import type { LoginData } from '@/services/types/user.type'

export interface LoginParams {
  username: string
  password: string
}

export async function login(params: LoginParams) {
  return lingtongFetch<LtResponse<LoginData>>('/api/auth/login', {
    method: 'POST',
    query: { site: 'client', lang: 'zh' },
    body: params,
  })
}
