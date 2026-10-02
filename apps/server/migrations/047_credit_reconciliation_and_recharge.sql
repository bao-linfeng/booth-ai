ALTER TABLE credit_transactions ADD COLUMN request_key text;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_recharge_request_key_check
  CHECK (request_key IS NULL OR (kind = 'recharge' AND operator_id IS NOT NULL AND length(request_key) BETWEEN 1 AND 200));
CREATE UNIQUE INDEX credit_recharge_request_unique ON credit_transactions(operator_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE INDEX credit_reservations_active_user_idx ON credit_reservations(user_id) WHERE status = 'reserved';
ALTER TABLE theme_jobs ADD COLUMN credit_checked_at timestamptz;
ALTER TABLE artwork_jobs ADD COLUMN credit_checked_at timestamptz;
CREATE INDEX theme_jobs_credit_check_idx ON theme_jobs(credit_checked_at NULLS FIRST, id);
CREATE INDEX artwork_jobs_credit_check_idx ON artwork_jobs(credit_checked_at NULLS FIRST, id);
CREATE INDEX artwork_jobs_reconciliation_idx ON artwork_jobs(updated_at, id)
  WHERE status IN ('pending', 'queued', 'running', 'settling');

UPDATE credit_reservations r SET status = 'released', updated_at = now()
FROM theme_jobs j WHERE r.theme_job_id = j.id AND j.status = 'failed' AND r.status = 'reserved'
  AND NOT EXISTS (SELECT 1 FROM credit_transactions t WHERE t.theme_job_id = j.id);
UPDATE credit_reservations r SET status = 'released', updated_at = now()
FROM artwork_jobs j WHERE r.artwork_job_id = j.id AND j.status = 'failed' AND r.status = 'reserved'
  AND NOT EXISTS (SELECT 1 FROM credit_transactions t WHERE t.artwork_job_id = j.id);
