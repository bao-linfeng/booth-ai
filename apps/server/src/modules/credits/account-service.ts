import type pg from 'pg';

export interface SignInConfig {
  enabled: boolean;
  dailyAmount: number;
  timezone: string;
}

export async function getCreditBalance(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query<{ balance: number }>(
    'SELECT balance FROM user_credit_balances WHERE user_id=$1', [userId],
  );
  return result.rows[0]?.balance ?? 0;
}

export async function getSignInConfig(pool: pg.Pool): Promise<SignInConfig> {
  const result = await pool.query<{ enabled: boolean; daily_amount: number; timezone: string }>(
    'SELECT enabled, daily_amount, timezone FROM sign_in_config WHERE id = TRUE',
  );
  const row = result.rows[0];
  if (!row) return { enabled: true, dailyAmount: 10, timezone: 'Asia/Shanghai' };
  return { enabled: row.enabled, dailyAmount: row.daily_amount, timezone: row.timezone };
}

export async function signInForCredits(pool: pg.Pool, userId: string): Promise<{ balance: number; amount: number }> {
  const config = await getSignInConfig(pool);
  if (!config.enabled) {
    throw Object.assign(new Error('Sign-in rewards are currently disabled'), { statusCode: 403, reason: 'SIGN_IN_DISABLED' });
  }
  const result = await pool.query<{ amount: number }>(`
    WITH signed AS (
      INSERT INTO sign_in_records (user_id, sign_date)
      VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE $2)::date)
      ON CONFLICT (user_id, sign_date) DO NOTHING
      RETURNING user_id
    )
    INSERT INTO credit_transactions (user_id, kind, amount)
    SELECT user_id, 'sign_in', $3 FROM signed
    RETURNING amount
  `, [userId, config.timezone, config.dailyAmount]);
  if (!result.rows[0]) throw Object.assign(new Error('Already signed in today'), { statusCode: 409, reason: 'ALREADY_SIGNED_IN' });
  return { amount: result.rows[0].amount, balance: await getCreditBalance(pool, userId) };
}
