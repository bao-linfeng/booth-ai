ALTER TABLE ai_model_configs DROP CONSTRAINT ai_model_configs_check;
ALTER TABLE ai_model_configs ADD CONSTRAINT ai_model_configs_check CHECK (
  (purpose='selection_parse' AND provider IN ('qwen','deepseek') AND unit_credits IS NULL) OR
  (purpose='theme' AND provider IN ('gemini','wanx','openai')) OR
  (purpose='artwork' AND provider IN ('openai','gemini'))
);
INSERT INTO ai_model_configs(purpose,provider) VALUES ('artwork','gemini') ON CONFLICT DO NOTHING;
