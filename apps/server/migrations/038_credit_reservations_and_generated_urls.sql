-- 积分预留表：提交 theme job 时原子预留积分，结算后释放
CREATE TABLE credit_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  theme_job_id    uuid NOT NULL REFERENCES theme_jobs(id) ON DELETE CASCADE,
  reserved_amount integer NOT NULL CHECK (reserved_amount > 0),
  status          text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'released')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_reservations_theme_job_unique UNIQUE (theme_job_id)
);

CREATE INDEX credit_reservations_user_id_idx ON credit_reservations (user_id);
CREATE INDEX credit_reservations_theme_job_id_idx ON credit_reservations (theme_job_id);

-- 主题生成中间表：生图完成后落盘原始 URL，供 settle 幂等消费
CREATE TABLE theme_job_generated_urls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES theme_jobs(id) ON DELETE CASCADE,
  ordinal    integer NOT NULL,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_job_generated_urls_job_ordinal_unique UNIQUE (job_id, ordinal)
);

CREATE INDEX theme_job_generated_urls_job_id_idx ON theme_job_generated_urls (job_id);
