-- Models are identified by their provider-side id; a separate display name drifted from it and misled admins.
DROP INDEX ai_models_name_key;
ALTER TABLE ai_models DROP COLUMN name;
CREATE UNIQUE INDEX ai_models_provider_model_key ON ai_models (provider_id, model);

-- Last model listing fetched from the provider, so admins pick models without calling the provider every time.
ALTER TABLE ai_providers
  ADD COLUMN model_catalog jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(model_catalog) = 'array'),
  ADD COLUMN catalog_refreshed_at timestamptz;
