import type { UserInfo } from '@vben/types';

import type { AdminCurrentUser } from './auth';

import { requestClient } from '#/api/request';

function mapToUserInfo(user: AdminCurrentUser): UserInfo {
  return {
    userId: user.id,
    username: user.username,
    realName: user.nickname ?? user.username,
    avatar: user.avatarPath ?? '',
    homePath: '/dashboard',
    roles: user.roles,
    desc: '',
    token: '',
    email: user.email ?? '',
  };
}

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  const user = await requestClient.get<AdminCurrentUser>('/v1/admin/me');
  return mapToUserInfo(user);
}
