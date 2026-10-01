import { requestClient } from '#/api/request';

export type CreditKind = 'artwork_consume' | 'recharge' | 'sign_in' | 'theme_consume';

export interface CreditTransaction {
  id: string;
  userId: string;
  username: null | string;
  nickname: null | string;
  kind: CreditKind;
  amount: number;
  note: null | string;
  operatorId: null | string;
  createdAt: string;
}

export interface CreditListParams {
  page: number;
  pageSize: number;
  userId?: string;
  kind?: CreditKind;
}

export interface CreditListResult {
  data: CreditTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RechargeParams {
  userId: string;
  amount: number;
  note?: string;
}

export interface CreditBalanceResult {
  balance: number;
}

export async function getCreditTransactionsApi(
  params: CreditListParams,
): Promise<CreditListResult> {
  return requestClient.get('/v1/admin/credits', { params });
}

export async function rechargeCreditApi(body: RechargeParams): Promise<void> {
  return requestClient.post('/v1/admin/credits/recharge', body);
}

export async function getUserCreditBalanceApi(
  userId: string,
): Promise<CreditBalanceResult> {
  return requestClient.get(`/v1/admin/credits/users/${userId}/balance`);
}
