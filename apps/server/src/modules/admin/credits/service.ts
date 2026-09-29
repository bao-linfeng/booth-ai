import type pg from 'pg';

export type CreditKind = 'sign_in' | 'recharge' | 'theme_consume';

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

export async function rechargeCredits(pool: pg.Pool, input: { userId: string; amount: number; note?: string; operatorId: string }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 2147483647) {
    throw Object.assign(new Error('Amount must be a positive integer'), { statusCode: 400, reason: 'INVALID_AMOUNT' });
  }
  if (!input.operatorId) throw Object.assign(new Error('Operator required'), { statusCode: 401, reason: 'AUTH_REQUIRED' });
  const inserted = await pool.query<{ id: string }>(`
    INSERT INTO credit_transactions (user_id, kind, amount, note, operator_id)
    SELECT id, 'recharge', $2, $3, $4 FROM users WHERE id=$1
    RETURNING id
  `, [input.userId, input.amount, input.note ?? null, input.operatorId]);
  if (!inserted.rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404, reason: 'USER_NOT_FOUND' });
  const result = await pool.query<CreditTransaction>(
    `SELECT ${columns} FROM credit_transactions ct LEFT JOIN users u ON u.id = ct.user_id WHERE ct.id=$1`,
    [inserted.rows[0].id],
  );
  return result.rows[0]!;
}

export async function getUserCreditBalance(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query<{ balance: number }>('SELECT balance FROM user_credit_balances WHERE user_id=$1', [userId]);
  return result.rows[0]?.balance ?? 0;
}
