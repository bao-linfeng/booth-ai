import { apiFetch } from '@/lib/api-client'

export async function getCreditBalance(): Promise<{ balance: number }> {
  const res = await apiFetch<{ code: number; data: { balance: number } }>(
    '/api/v1/client/credits/balance',
    { method: 'GET' }
  )
  return res.data
}

export async function signInForCredits(): Promise<{ amount: number; balance: number }> {
  const res = await apiFetch<{ code: number; data: { amount: number; balance: number } }>(
    '/api/v1/client/credits/sign-in',
    { method: 'POST' }
  )
  return res.data
}
