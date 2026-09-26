import type pg from 'pg';

export interface AccountRecord {
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

interface AccountRow {
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
  lastLoginAt: Date | string | null;
  lastSyncedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ListAccountsOptions {
  page: number;
  pageSize: number;
  username?: string;
  email?: string;
  phone?: string;
}

export interface AccountList {
  data: AccountRecord[];
  total: number;
  page: number;
  pageSize: number;
}

type AccountTable = 'users' | 'admins';

const accountColumns = `
  id,
  external_user_id::text AS "externalUserId",
  username,
  nickname,
  email,
  mobile,
  avatar_path AS "avatarPath",
  company,
  country,
  city,
  language_code AS "languageCode",
  enabled,
  roles,
  permissions,
  last_login_at AS "lastLoginAt",
  last_synced_at AS "lastSyncedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function notFoundError(): Error & { statusCode: number } {
  const error = new Error('Account not found') as Error & { statusCode: number };
  error.statusCode = 404;
  return error;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    ...row,
    lastLoginAt: row.lastLoginAt === null ? null : toIsoString(row.lastLoginAt),
    lastSyncedAt: toIsoString(row.lastSyncedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function filters(options: ListAccountsOptions, supportsPhoneFilter: boolean): { clause: string; values: string[] } {
  const conditions: string[] = [];
  const values: string[] = [];
  if (options.username) {
    values.push(`%${options.username}%`);
    conditions.push(`username ILIKE $${values.length}`);
  }
  if (options.email) {
    values.push(`%${options.email}%`);
    conditions.push(`email ILIKE $${values.length}`);
  }
  if (supportsPhoneFilter && options.phone) {
    values.push(`%${options.phone}%`);
    conditions.push(`mobile ILIKE $${values.length}`);
  }
  return { clause: conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`, values };
}

async function listAccounts(pool: pg.Pool, table: AccountTable, options: ListAccountsOptions, supportsPhoneFilter: boolean): Promise<AccountList> {
  const { clause, values } = filters(options, supportsPhoneFilter);
  const offset = (options.page - 1) * options.pageSize;
  const [recordsResult, countResult] = await Promise.all([
    pool.query<AccountRow>(`SELECT ${accountColumns} FROM ${table}${clause} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, options.pageSize, offset]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM ${table}${clause}`, values),
  ]);
  return {
    data: recordsResult.rows.map(toAccountRecord),
    total: Number(countResult.rows[0]?.total ?? 0),
    page: options.page,
    pageSize: options.pageSize,
  };
}

async function getAccount(pool: pg.Pool, table: AccountTable, id: string): Promise<AccountRecord> {
  const result = await pool.query<AccountRow>(`SELECT ${accountColumns} FROM ${table} WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw notFoundError();
  return toAccountRecord(row);
}

export function listUsers(pool: pg.Pool, options: ListAccountsOptions): Promise<AccountList> {
  return listAccounts(pool, 'users', options, true);
}

export function getUser(pool: pg.Pool, id: string): Promise<AccountRecord> {
  return getAccount(pool, 'users', id);
}

export function listAdmins(pool: pg.Pool, options: ListAccountsOptions): Promise<AccountList> {
  return listAccounts(pool, 'admins', options, false);
}

export function getAdmin(pool: pg.Pool, id: string): Promise<AccountRecord> {
  return getAccount(pool, 'admins', id);
}
