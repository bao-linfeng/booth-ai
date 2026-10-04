import { requestClient } from '#/api/request';
import { getAdminAccessApi } from './roles';

export interface AdminCurrentUser {
  id: string;
  externalUserId: string;
  accountType: 'admin' | 'client';
  username: string;
  nickname: null | string;
  email: null | string;
  mobile: null | string;
  avatarPath: null | string;
  company: null | string;
  country: null | string;
  city: null | string;
  languageCode: null | string;
  enabled: boolean;
  roles: string[];
  permissions: string[];
  lastSyncedAt: string;
  homePath: string;
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
  return (await getAdminAccessApi()).permissions;
}
