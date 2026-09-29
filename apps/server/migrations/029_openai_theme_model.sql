ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_provider_check;
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_provider_check
  CHECK (provider IN ('qwen', 'deepseek', 'gemini', 'wanx', 'openai'));

ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_check;
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_check
  CHECK ((purpose = 'selection_parse' AND provider IN ('qwen', 'deepseek') AND unit_credits IS NULL)
    OR (purpose = 'theme' AND provider IN ('gemini', 'wanx', 'openai')));

INSERT INTO ai_model_configs (purpose, provider) VALUES ('theme', 'openai');
