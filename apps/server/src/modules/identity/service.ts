import type { ExternalUserDetail } from '../../infra/external-auth.js';

export type UserType = 'client' | 'su';

export interface CurrentUser {
  id: string;
  externalUserId: string;
  accountType: 'client' | 'admin';
  type?: UserType;
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
  lastSyncedAt: string;
  loginSource: 'password' | 'sso_token';
}

export function toCurrentUser(
  localId: string,
  detail: ExternalUserDetail,
  accountType: 'client' | 'admin',
  loginSource: 'password' | 'sso_token',
  type?: UserType,
): CurrentUser {
  return {
    id: localId,
    externalUserId: String(detail.externalUserId),
    accountType,
    ...(type === undefined ? {} : { type }),
    username: detail.username,
    nickname: detail.nickname,
    email: detail.email,
    mobile: detail.mobile,
    avatarPath: detail.avatarPath,
    company: detail.company,
    country: detail.country,
    city: detail.city,
    languageCode: detail.languageCode,
    enabled: detail.enabled,
    roles: detail.roles,
    permissions: detail.permissions,
    lastSyncedAt: new Date().toISOString(),
    loginSource,
  };
}
