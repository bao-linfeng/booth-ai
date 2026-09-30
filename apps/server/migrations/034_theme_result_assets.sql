ALTER TABLE theme_job_results
  ALTER COLUMN asset_id TYPE uuid USING asset_id::uuid;
