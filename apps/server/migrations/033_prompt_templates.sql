CREATE TABLE prompt_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose          text NOT NULL CHECK (purpose IN ('theme', 'artwork')),
  industry_id      uuid REFERENCES dictionary_items(id),
  style_id         uuid REFERENCES dictionary_items(id),
  body             text NOT NULL,
  variables        text[] NOT NULL DEFAULT '{}',
  enabled          boolean NOT NULL DEFAULT false,
  revision         integer NOT NULL DEFAULT 1,
  created_by       uuid REFERENCES admins(id),
  updated_by       uuid REFERENCES admins(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prompt_templates_active_unique
  ON prompt_templates (purpose, COALESCE(industry_id::text, ''), COALESCE(style_id::text, ''))
  WHERE enabled = true;

CREATE INDEX prompt_templates_purpose_idx ON prompt_templates (purpose);
CREATE INDEX prompt_templates_enabled_idx ON prompt_templates (enabled);
