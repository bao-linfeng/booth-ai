import type pg from 'pg';

export async function getCreditBalance(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query<{ balance: number }>(
    'SELECT balance FROM user_credit_balances WHERE user_id=$1', [userId],
  );
  return result.rows[0]?.balance ?? 0;
}

export async function signInForCredits(pool: pg.Pool, userId: string): Promise<{ balance: number; amount: number }> {
  const result = await pool.query<{ amount: number }>(`
    WITH signed AS (
      INSERT INTO sign_in_records (user_id, sign_date)
      VALUES ($1, CURRENT_DATE)
      ON CONFLICT (user_id, sign_date) DO NOTHING
      RETURNING user_id
    )
    INSERT INTO credit_transactions (user_id, kind, amount)
    SELECT user_id, 'sign_in', 10 FROM signed
    RETURNING amount
  `, [userId]);
  if (!result.rows[0]) throw Object.assign(new Error('Already signed in today'), { statusCode: 409, reason: 'ALREADY_SIGNED_IN' });
  return { amount: result.rows[0].amount, balance: await getCreditBalance(pool, userId) };
}
