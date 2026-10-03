-- Admin-managed AI configuration: providers (protocol + base URL + key) -> models -> per-purpose assignments.
CREATE TABLE ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  protocol text NOT NULL CHECK (protocol ~ '^[a-z][a-z0-9_-]{0,31}$'),
  base_url text NOT NULL CHECK (base_url ~ '^https://'),
  credential_ciphertext bytea,
  -- AES-GCM associated data, fixed at creation: the provider id, or the legacy provider key for migrated rows.
  credential_scope text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_providers_name_key ON ai_providers (lower(btrim(name)));

CREATE TABLE ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('text', 'image')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  params jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(params) = 'object'),
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_models_name_key ON ai_models (lower(btrim(name)));
CREATE INDEX ai_models_provider_idx ON ai_models (provider_id);

CREATE TABLE ai_model_assignments (
  purpose text NOT NULL CHECK (purpose IN ('selection_parse', 'theme', 'artwork')),
  model_id uuid NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 20),
  unit_credits integer CHECK (unit_credits BETWEEN 1 AND 100000),
  PRIMARY KEY (purpose, model_id),
  UNIQUE (purpose, position),
  CHECK ((purpose = 'selection_parse') = (unit_credits IS NULL))
);
CREATE INDEX ai_model_assignments_model_idx ON ai_model_assignments (model_id);

-- Carry over configured legacy rows. Model ids and endpoints used to live in code.
CREATE TEMP TABLE legacy_ai_models (purpose text, provider text, provider_name text, protocol text, base_url text,
  model text, model_name text, kind text, params jsonb) ON COMMIT DROP;
INSERT INTO legacy_ai_models VALUES
  ('selection_parse', 'qwen', '通义千问', 'openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus', '通义千问 Plus', 'text', '{"temperature":0,"jsonMode":"on"}'),
  ('selection_parse', 'deepseek', 'DeepSeek', 'openai', 'https://api.deepseek.com', 'deepseek-v4-flash', 'DeepSeek V4 Flash', 'text', '{"temperature":0,"jsonMode":"on"}'),
  ('theme', 'gemini', 'Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-3.1-flash-image', 'Gemini Nano Banana', 'image', '{"imageSize":"2K"}'),
  ('artwork', 'gemini', 'Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-3.1-flash-image', 'Gemini Nano Banana', 'image', '{"imageSize":"2K"}'),
  ('theme', 'wanx', '通义万相', 'dashscope', 'https://dashscope.aliyuncs.com/api/v1', 'wanx2.1-imageedit', '通义万相 2.1', 'image', '{}'),
  ('theme', 'openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-image-2.5-sunburst', 'GPT Image 2.5', 'image', '{"quality":"auto"}'),
  ('artwork', 'openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-image-1.5', 'GPT Image 1.5', 'image', '{"quality":"auto"}');

-- One provider per legacy provider key; when purposes held different keys, the enabled row's key wins.
INSERT INTO ai_providers (name, protocol, base_url, credential_ciphertext, credential_scope)
SELECT DISTINCT ON (c.provider) l.provider_name, l.protocol, l.base_url, c.credential_ciphertext, c.provider
FROM ai_model_configs c JOIN legacy_ai_models l ON l.purpose = c.purpose AND l.provider = c.provider
WHERE c.credential_ciphertext IS NOT NULL
ORDER BY c.provider, c.enabled DESC, c.purpose;

INSERT INTO ai_models (provider_id, name, kind, model, params)
SELECT DISTINCT ON (l.model) p.id, l.model_name, l.kind, l.model, l.params
FROM ai_model_configs c
JOIN legacy_ai_models l ON l.purpose = c.purpose AND l.provider = c.provider
JOIN ai_providers p ON p.credential_scope = c.provider
ORDER BY l.model, c.enabled DESC;

-- Only rows that were actually serving traffic become assignments; theme/artwork order keeps the old provider-name order.
INSERT INTO ai_model_assignments (purpose, model_id, position, unit_credits)
SELECT c.purpose, m.id, row_number() OVER (PARTITION BY c.purpose ORDER BY NULLIF(c.priority, 0) NULLS LAST, c.provider),
  CASE WHEN c.purpose = 'selection_parse' THEN NULL ELSE c.unit_credits END
FROM ai_model_configs c
JOIN legacy_ai_models l ON l.purpose = c.purpose AND l.provider = c.provider
JOIN ai_models m ON m.model = l.model
WHERE c.enabled AND c.credential_ciphertext IS NOT NULL AND (c.purpose = 'selection_parse' OR c.unit_credits IS NOT NULL);

DROP TABLE ai_model_configs;

ALTER TABLE theme_job_provider_attempts ADD COLUMN model_id uuid;
