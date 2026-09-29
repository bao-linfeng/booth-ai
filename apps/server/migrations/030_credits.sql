-- 积分流水表（本地账本）
CREATE TABLE credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('sign_in', 'recharge', 'theme_consume')),
  amount integer NOT NULL,
  note text,
  operator_id uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX credit_transactions_user_idx ON credit_transactions (user_id, created_at DESC);
CREATE INDEX credit_transactions_kind_idx ON credit_transactions (kind, created_at DESC);

-- 签到记录表（防重复签到）
CREATE TABLE sign_in_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  sign_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sign_date)
);

-- 用户积分余额视图（从流水聚合）
CREATE VIEW user_credit_balances AS
  SELECT user_id, COALESCE(SUM(amount), 0)::integer AS balance
  FROM credit_transactions
  GROUP BY user_id;
