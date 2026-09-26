import { apiFetch } from '@/lib/api-client'
import type { IResponse } from '@/services/types/response.type'
import type { LoginResult } from '@/services/types/user.type'

export interface LoginParams {
  username: string
  password: string
}

export async function loginApi(params: LoginParams) {
  return apiFetch<IResponse<LoginResult>>('/api/v1/client/auth/login', {
    method: 'POST',
    body: params,
  })
}

export async function logoutApi() {
  return apiFetch('/api/v1/client/auth/logout', { method: 'POST' })
}
