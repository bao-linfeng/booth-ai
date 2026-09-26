import { requestClient } from '#/api/request';

export interface UserRecord {
  id: string;
  externalUserId: string;
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
  lastLoginAt: null | string;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserListParams {
  page: number;
  pageSize: number;
  username?: string;
  phone?: string;
  email?: string;
}

export interface UserListResult {
  data: UserRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getUserListApi(
  params: UserListParams,
): Promise<UserListResult> {
  return requestClient.get('/v1/admin/users', { params });
}

export async function getUserDetailApi(id: string): Promise<UserRecord> {
  return requestClient.get(`/v1/admin/users/${id}`);
}

export async function getAdminListApi(
  params: Omit<UserListParams, 'phone'>,
): Promise<UserListResult> {
  return requestClient.get('/v1/admin/admins', { params });
}

export async function getAdminDetailApi(id: string): Promise<UserRecord> {
  return requestClient.get(`/v1/admin/admins/${id}`);
}
