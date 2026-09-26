import { apiFetch } from '@/lib/api-client'
import type { IResponse } from '@/services/types/response.type'
import type { CurrentUser } from '@/services/types/user.type'

export async function fetchCurrentUser() {
  return apiFetch<IResponse<CurrentUser>>('/api/v1/client/me', { method: 'GET' })
}
