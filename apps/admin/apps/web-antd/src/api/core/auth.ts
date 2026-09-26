import { requestClient } from '#/api/request';

export interface AdminCurrentUser {
  id: string
  externalUserId: string
  accountType: 'client' | 'admin'
  username: string
  nickname: string | null
  email: string | null
  mobile: string | null
  avatarPath: string | null
  company: string | null
  country: string | null
  city: string | null
  languageCode: string | null
  enabled: boolean
  roles: string[]
  permissions: string[]
  lastSyncedAt: string
}

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    username?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
    expiresAt: string;
    user: AdminCurrentUser;
  }
}

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  return requestClient.post<AuthApi.LoginResult>('/v1/admin/auth/login', data);
}

/**
 * 退出登录
 */
export async function logoutApi() {
  return requestClient.post('/v1/admin/auth/logout');
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi(): Promise<string[]> {
  return [];
}
