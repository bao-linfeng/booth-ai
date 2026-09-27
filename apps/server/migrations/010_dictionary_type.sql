ALTER TABLE dictionaries
  ADD COLUMN type text;

CREATE INDEX dictionaries_type_idx ON dictionaries(type) WHERE type IS NOT NULL;
