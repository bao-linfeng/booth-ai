CREATE TABLE ai_model_configs (
  purpose text NOT NULL CHECK (purpose IN ('selection_parse', 'theme')),
  provider text NOT NULL CHECK (provider IN ('qwen', 'deepseek', 'gemini', 'wanx')),
  enabled boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 2),
  unit_credits integer CHECK (unit_credits > 0),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purpose, provider),
  CHECK ((purpose = 'selection_parse' AND provider IN ('qwen', 'deepseek') AND unit_credits IS NULL)
    OR (purpose = 'theme' AND provider IN ('gemini', 'wanx')))
);

INSERT INTO ai_model_configs (purpose, provider) VALUES
  ('selection_parse', 'qwen'), ('selection_parse', 'deepseek'),
  ('theme', 'gemini'), ('theme', 'wanx');

CREATE UNIQUE INDEX ai_model_configs_parse_priority ON ai_model_configs (priority)
  WHERE purpose = 'selection_parse' AND enabled AND priority > 0;
