ALTER TABLE prompt_templates DROP CONSTRAINT prompt_templates_purpose_check;
ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_purpose_check
  CHECK (purpose IN ('filter', 'theme', 'artwork'));
ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_filter_scope_check
  CHECK (purpose <> 'filter' OR (industry_id IS NULL AND style_id IS NULL));

ALTER TABLE selection_parses ADD COLUMN prompt_snapshot jsonb;
