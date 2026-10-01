import type { Config } from '../config.js';

export interface ExternalLoginResult {
  externalUserId: number;
  username: string;
  email: string | null;
  externalJwt: string;
}

export interface ExternalUserDetail {
  externalUserId: number;
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
}

type ExternalError = Error & { statusCode: number; code?: string };
const allowedRoles = new Set(['ROLE_ADMIN', 'ROLE_USER', 'ROLE_VIP']);
const allowedPermissions = new Set([
  'scheme.read', 'scheme.edit', 'scheme.import', 'scheme.review', 'scheme.publish',
  'catalog.manage', 'asset.manage',
]);

function externalError(message: string, statusCode: number, code?: string): ExternalError {
  const error = new Error(message) as ExternalError;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status === 401) throw externalError('External authentication required', 401);
    if (response.status === 403) throw externalError('External authentication forbidden', 403);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw externalError('External authentication service returned invalid JSON', 502);
    }
    if (!response.ok) throw externalError('External authentication service request failed', 502);
    return body;
  } catch (error) {
    if ((error as Partial<ExternalError>).statusCode) throw error;
    throw externalError('External authentication service is unavailable', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function externalBaseUrl(config: Config): string {
  return config.externalApiUrl.replace(/\/$/, '');
}

export async function loginExternal(
  config: Config,
  site: 'client' | 'admin',
  username: string,
  password: string,
): Promise<ExternalLoginResult> {
  const body: Record<string, string> = { username, password };
  if (site === 'client') body.lang = 'zh';
  const response = await fetchJson(`${externalBaseUrl(config)}/api/auth/login?site=${encodeURIComponent(site)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!isRecord(response) || response.success !== true || response.code !== '200') {
    throw externalError('Invalid username or password', 400);
  }
  const data = isRecord(response.data) ? response.data : null;
  const account = data && isRecord(data.data) ? data.data : null;
  const externalUserId = account?.id;
  const accountUsername = account?.username;
  const externalJwt = data?.JWT;
  if (typeof externalUserId !== 'number' || !Number.isSafeInteger(externalUserId) || typeof accountUsername !== 'string' || !accountUsername) {
    throw externalError('External authentication response is invalid', 400);
  }
  if (typeof externalJwt !== 'string' || !externalJwt) {
    throw externalError('External authentication response is missing a token', 502);
  }
  return { externalUserId, username: accountUsername, email: stringOrNull(account.email), externalJwt };
}

export async function fetchExternalUserDetail(config: Config, username: string, externalJwt: string): Promise<ExternalUserDetail> {
  const response = await fetchJson(`${externalBaseUrl(config)}/api/user/username/${encodeURIComponent(username)}`, {
    headers: { authorization: `Bearer ${externalJwt}`, accept: 'application/json' },
  });
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) {
    throw externalError('External user profile request failed', 502);
  }
  const data = response.data;
  const externalUserId = data.id;
  const detailUsername = data.username;
  if (typeof externalUserId !== 'number' || !Number.isSafeInteger(externalUserId) || typeof detailUsername !== 'string' || !detailUsername || typeof data.enabled !== 'boolean') {
    throw externalError('External user profile response is invalid', 502);
  }
  if (data.enabled === false) throw externalError('Account is disabled', 403, 'ACCOUNT_DISABLED');

  const roleRecords = Array.isArray(data.roles) ? data.roles.filter(isRecord) : [];
  const roles = [...new Set(roleRecords.map(role => stringOrNull(role.name)).filter((role): role is string => role !== null && allowedRoles.has(role)))];
  const permissions = [...new Set(roleRecords.flatMap(role => {
    const rolePermissions = Array.isArray(role.roleEntityPermissions) ? role.roleEntityPermissions.filter(isRecord) : [];
    return rolePermissions.map(permission => stringOrNull(permission.permission)).filter((permission): permission is string => permission !== null && allowedPermissions.has(permission));
  }))];
  const fkAvatarId = typeof data.fkAvatarId === 'number' && Number.isSafeInteger(data.fkAvatarId) ? data.fkAvatarId : null;
  const avatarUrl = fkAvatarId !== null ? `${externalBaseUrl(config)}/api/attachment/images/${fkAvatarId}` : null;
  return {
    externalUserId,
    username: detailUsername,
    nickname: stringOrNull(data.nickname),
    email: stringOrNull(data.email),
    mobile: stringOrNull(data.mobile),
    avatarPath: avatarUrl,
    company: stringOrNull(data.company),
    country: stringOrNull(data.country),
    city: stringOrNull(data.city),
    languageCode: stringOrNull(data.fkLanguageCode),
    enabled: data.enabled,
    roles,
    permissions,
  };
}

export function checkAdminRole(roles: string[]): void {
  if (!roles.includes('ROLE_ADMIN')) throw externalError('Administrator role required', 403);
}
