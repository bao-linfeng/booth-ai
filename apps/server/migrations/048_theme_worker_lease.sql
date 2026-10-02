ALTER TABLE theme_jobs
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz;

CREATE INDEX theme_jobs_expired_lease_idx ON theme_jobs (lease_until)
WHERE status IN ('running', 'settling') AND lease_until IS NOT NULL;
