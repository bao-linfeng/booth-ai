-- 积分流水添加 theme_job_id 幂等唯一约束，防止 settle 重试时重复扣费
ALTER TABLE credit_transactions ADD COLUMN theme_job_id uuid REFERENCES theme_jobs(id);
CREATE UNIQUE INDEX credit_transactions_theme_job_unique ON credit_transactions (theme_job_id) WHERE theme_job_id IS NOT NULL;
