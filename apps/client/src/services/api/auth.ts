import { apiFetch, getVisitorId } from '@/lib/api-client'
import type { IResponse } from '@/services/types/response.type'
import type { LoginResult } from '@/services/types/user.type'

export interface LoginParams {
  username: string
  password: string
}

export async function login(params: LoginParams): Promise<LoginResult> {
  const response = await apiFetch<IResponse<LoginResult>>('/api/v1/client/auth/login', {
    method: 'POST',
    body: { ...params, type: 'client' },
    headers: { 'x-visitor-id': getVisitorId() },
  })
  return response.data
}

export async function logout(): Promise<void> {
  await apiFetch('/api/v1/client/auth/logout', { method: 'POST' })
}

export async function syncAuth(params: { username: string; token: string; type?: 'client' | 'su' }): Promise<LoginResult> {
  const response = await apiFetch<IResponse<LoginResult>>('/api/v1/client/auth/sync', {
    method: 'POST',
    body: { ...params, type: params.type ?? 'client' },
    headers: { 'x-visitor-id': getVisitorId() },
  })
  return response.data
}
