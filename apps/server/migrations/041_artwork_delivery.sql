ALTER TABLE artwork_jobs ALTER COLUMN artwork_key DROP NOT NULL;
ALTER TABLE artwork_jobs ADD COLUMN theme_job_id uuid REFERENCES theme_jobs(id) ON DELETE RESTRICT;
ALTER TABLE artwork_jobs ADD COLUMN theme_result_id uuid REFERENCES theme_job_results(id) ON DELETE RESTRICT;
ALTER TABLE artwork_jobs ADD COLUMN theme_selection_revision integer;
ALTER TABLE artwork_jobs ADD COLUMN request_hash text;
ALTER TABLE artwork_jobs ADD COLUMN generation_snapshot jsonb;
ALTER TABLE artwork_jobs ADD COLUMN delivery_status text NOT NULL DEFAULT 'incomplete'
  CHECK (delivery_status IN ('pending','incomplete','ready'));
ALTER TABLE artwork_jobs ADD COLUMN lease_token uuid;
ALTER TABLE artwork_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE artwork_jobs ADD CONSTRAINT artwork_jobs_theme_context CHECK (
  (theme_job_id IS NULL AND theme_result_id IS NULL AND theme_selection_revision IS NULL) OR
  (theme_job_id IS NOT NULL AND theme_result_id IS NOT NULL AND theme_selection_revision > 0 AND requested_count = 4 AND artwork_key IS NULL)
);
CREATE INDEX artwork_jobs_theme_context_idx ON artwork_jobs(user_id,theme_job_id,theme_result_id,theme_selection_revision,created_at DESC);

ALTER TABLE artwork_job_results ADD COLUMN direction text CHECK (direction IN ('front','back','left','right'));
ALTER TABLE artwork_job_results ADD COLUMN asset_version_id uuid REFERENCES asset_versions(id) ON DELETE RESTRICT;
UPDATE artwork_job_results r SET asset_version_id = (
  SELECT v.id FROM asset_versions v WHERE v.asset_id=r.asset_id ORDER BY v.created_at DESC,v.id DESC LIMIT 1
);
CREATE UNIQUE INDEX artwork_job_results_direction_unique ON artwork_job_results(job_id,direction) WHERE direction IS NOT NULL;
CREATE TABLE artwork_job_directions (
  job_id uuid NOT NULL REFERENCES artwork_jobs(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('front','back','left','right')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitting','generated','succeeded','failed')),
  generated_url text,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,direction)
);

ALTER TABLE credit_reservations ALTER COLUMN theme_job_id DROP NOT NULL;
ALTER TABLE credit_reservations ADD COLUMN artwork_job_id uuid UNIQUE REFERENCES artwork_jobs(id) ON DELETE RESTRICT;
ALTER TABLE credit_reservations ADD CONSTRAINT credit_reservations_one_job CHECK (num_nonnulls(theme_job_id,artwork_job_id)=1);
ALTER TABLE credit_transactions ADD COLUMN artwork_job_id uuid REFERENCES artwork_jobs(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX credit_transactions_artwork_job_unique ON credit_transactions(artwork_job_id) WHERE artwork_job_id IS NOT NULL;
ALTER TABLE credit_transactions DROP CONSTRAINT credit_transactions_kind_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_kind_check CHECK (kind IN ('sign_in','recharge','theme_consume','artwork_consume'));

ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_purpose_check;
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_purpose_check CHECK (purpose IN ('selection_parse','theme','artwork'));
ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_check;
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_check CHECK (
  (purpose='selection_parse' AND provider IN ('qwen','deepseek') AND unit_credits IS NULL) OR
  (purpose='theme' AND provider IN ('gemini','wanx','openai')) OR
  (purpose='artwork' AND provider='openai')
);
INSERT INTO ai_model_configs(purpose,provider) VALUES ('artwork','openai');
