import { lingtongFetch } from '@/lib/api-client'
import type { LtResponse } from '@/services/types/response.type'
import type { UserDetail } from '@/services/types/user.type'

export async function fetchUserByUsername(username: string) {
  return lingtongFetch<LtResponse<UserDetail>>(`/api/user/username/${username}`, {
    method: 'GET',
  })
}
