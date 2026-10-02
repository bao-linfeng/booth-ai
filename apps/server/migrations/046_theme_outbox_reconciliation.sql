CREATE INDEX theme_jobs_dispatch_recovery_idx ON theme_jobs (updated_at, id)
WHERE status IN ('pending', 'queued');
