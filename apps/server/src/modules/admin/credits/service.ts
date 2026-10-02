import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import { lockCreditUser } from '../../credits/service.js';

export type CreditKind = 'sign_in' | 'recharge' | 'theme_consume' | 'artwork_consume';

interface CreditTransaction {
  id: string;
  userId: string;
  username: string | null;
  nickname: string | null;
  kind: CreditKind;
  amount: number;
  note: string | null;
  operatorId: string | null;
  createdAt: Date;
}

const columns = `
  ct.id,
  ct.user_id AS "userId",
  u.username,
  u.nickname,
  ct.kind,
  ct.amount,
  ct.note,
  ct.operator_id AS "operatorId",
  ct.created_at AS "createdAt"
`;

export async function listCreditTransactions(pool: pg.Pool, options: { page: number; pageSize: number; userId?: string; kind?: CreditKind }) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (options.userId) {
    values.push(options.userId);
    conditions.push(`ct.user_id=$${values.length}`);
  }
  if (options.kind) {
    values.push(options.kind);
    conditions.push(`ct.kind=$${values.length}`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const from = `credit_transactions ct LEFT JOIN users u ON u.id = ct.user_id`;
  const [records, count] = await Promise.all([
    pool.query<CreditTransaction>(`SELECT ${columns} FROM ${from}${where} ORDER BY ct.created_at DESC, ct.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, options.pageSize, (options.page - 1) * options.pageSize]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM ${from}${where}`, values),
  ]);
  return { data: records.rows, total: Number(count.rows[0]?.total ?? 0), page: options.page, pageSize: options.pageSize };
}

export async function rechargeCredits(pool: pg.Pool, input: { userId: string; amount: number; note?: string; operatorId: string; requestKey: string }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 2147483647) {
    throw Object.assign(new Error('Amount must be a positive integer'), { statusCode: 400, reason: 'INVALID_AMOUNT' });
  }
  if (!input.operatorId) throw Object.assign(new Error('Operator required'), { statusCode: 401, reason: 'AUTH_REQUIRED' });
  if (!input.requestKey?.trim() || input.requestKey.length > 200) {
    throw Object.assign(new Error('Request key required'), { statusCode: 400, reason: 'INVALID_REQUEST_KEY' });
  }
  return transaction(pool, async client => {
    await lockCreditUser(client, input.userId);
    await client.query(`INSERT INTO credit_transactions (user_id, kind, amount, note, operator_id, request_key)
      VALUES ($1, 'recharge', $2, $3, $4, $5)
      ON CONFLICT (operator_id, request_key) WHERE request_key IS NOT NULL DO NOTHING`,
    [input.userId, input.amount, input.note ?? null, input.operatorId, input.requestKey]);
    const result = (await client.query<CreditTransaction>(
      `SELECT ${columns} FROM credit_transactions ct LEFT JOIN users u ON u.id = ct.user_id
       WHERE ct.operator_id = $1 AND ct.request_key = $2`, [input.operatorId, input.requestKey],
    )).rows[0];
    if (!result) throw new Error('Recharge transaction missing');
    if (result.userId !== input.userId || result.amount !== input.amount || result.note !== (input.note ?? null)) {
      throw Object.assign(new Error('Request key already used with different parameters'), { statusCode: 409, reason: 'REQUEST_CONFLICT' });
    }
    return result;
  });
}

export async function getUserCreditBalance(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query<{ balance: number }>('SELECT balance FROM user_credit_balances WHERE user_id=$1', [userId]);
  return result.rows[0]?.balance ?? 0;
}
