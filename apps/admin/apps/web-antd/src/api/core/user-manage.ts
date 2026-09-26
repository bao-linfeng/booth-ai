import { requestClient } from '#/api/request';

export interface UserRecord {
  id: string;
  externalUserId: string;
  username: string;
  nickname: string | null;
  email: string | null;
  mobile: string | null;
  avatarPath: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  languageCode: string | null;
  enabled: boolean;
  roles: string[];
  permissions: string[];
  lastLoginAt: string | null;
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

export async function getUserListApi(params: UserListParams): Promise<UserListResult> {
  return requestClient.get('/v1/admin/users', { params });
}

export async function getUserDetailApi(id: string): Promise<UserRecord> {
  return requestClient.get(`/v1/admin/users/${id}`);
}

export async function getAdminListApi(params: Omit<UserListParams, 'phone'>): Promise<UserListResult> {
  return requestClient.get('/v1/admin/admins', { params });
}

export async function getAdminDetailApi(id: string): Promise<UserRecord> {
  return requestClient.get(`/v1/admin/admins/${id}`);
}
