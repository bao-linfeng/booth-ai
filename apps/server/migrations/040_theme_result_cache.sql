ALTER TABLE theme_jobs
  ADD COLUMN cache_key text,
  ADD COLUMN generation_snapshot jsonb,
  ADD COLUMN cache_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN cached_from_job_id uuid REFERENCES theme_jobs(id) ON DELETE SET NULL;

CREATE INDEX theme_jobs_result_cache_idx ON theme_jobs (user_id, cache_key, created_at DESC)
  WHERE status = 'succeeded' AND cache_hit = false;

ALTER TABLE theme_job_results
  ADD COLUMN asset_version_id uuid REFERENCES asset_versions(id);

UPDATE theme_job_results r SET asset_version_id = (
  SELECT v.id FROM asset_versions v WHERE v.asset_id = r.asset_id
  ORDER BY v.created_at DESC, v.id DESC LIMIT 1
);
