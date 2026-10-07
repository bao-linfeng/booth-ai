import { requestClient } from '#/api/request';

export type CreditKind =
  | 'artwork_consume'
  | 'recharge'
  | 'sign_in'
  | 'theme_consume';

export interface CreditTransaction {
  id: string;
  userId: string;
  username: null | string;
  nickname: null | string;
  kind: CreditKind;
  amount: number;
  note: null | string;
  operatorId: null | string;
  operatorName: null | string;
  /** 消费流水关联的生成任务；签到、充值为 null。 */
  jobType: 'artwork' | 'theme' | null;
  jobId: null | string;
  createdAt: string;
}

export interface CreditListParams {
  page: number;
  pageSize: number;
  userId?: string;
  kind?: CreditKind;
  jobId?: string;
}

export interface CreditListResult {
  data: CreditTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RechargeParams {
  requestKey: string;
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

export interface SignInConfig {
  enabled: boolean;
  dailyAmount: number;
  timezone: string;
}

export async function getSignInConfigApi(): Promise<SignInConfig> {
  return requestClient.get('/v1/admin/credits/sign-in-config');
}

export async function updateSignInConfigApi(body: SignInConfig): Promise<SignInConfig> {
  return requestClient.put('/v1/admin/credits/sign-in-config', body);
}
