-- Usable (purpose, provider) pairs now live in the server model catalog; rows are created on first admin save.
ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_provider_check;
ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_check;
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_provider_format_check CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$');
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_parse_credits_check CHECK (purpose <> 'selection_parse' OR unit_credits IS NULL);
ALTER TABLE theme_job_provider_attempts DROP CONSTRAINT theme_job_provider_attempts_provider_check;
