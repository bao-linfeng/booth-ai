import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';
import type { AdminCurrentUser } from './auth';

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
  };
}

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  const user = await requestClient.get<AdminCurrentUser>('/v1/admin/me');
  return mapToUserInfo(user);
}
