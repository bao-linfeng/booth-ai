ALTER TABLE dictionary_items
  ADD COLUMN labels jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN length_mm integer,
  ADD COLUMN width_mm integer,
  ADD COLUMN height_mm integer,
  ADD CONSTRAINT dictionary_item_labels_object CHECK (jsonb_typeof(labels) = 'object'),
  ADD CONSTRAINT dictionary_item_aliases_array CHECK (jsonb_typeof(aliases) = 'array'),
  ADD CONSTRAINT dictionary_item_size_complete CHECK (
    (length_mm IS NULL AND width_mm IS NULL AND height_mm IS NULL) OR
    (length_mm IS NOT NULL AND width_mm IS NOT NULL AND height_mm IS NOT NULL
      AND length_mm > 0 AND width_mm > 0 AND height_mm > 0
      AND item_value = length_mm::text || '-' || width_mm::text || '-' || height_mm::text)
  );

INSERT INTO dictionaries (code, name, type) VALUES ('booth_size', '方案尺寸（长×宽×高）', 'selection')
ON CONFLICT (code) DO NOTHING;

INSERT INTO dictionary_items (dictionary_id, item_value, item_label, length_mm, width_mm, height_mm)
SELECT d.id, s.length_mm::text || '-' || s.width_mm::text || '-' || s.height_mm::text,
  trim_scale(s.length_mm::numeric / 1000)::text || ' × ' || trim_scale(s.width_mm::numeric / 1000)::text
    || ' × ' || trim_scale(s.height_mm::numeric / 1000)::text || ' m',
  s.length_mm, s.width_mm, s.height_mm
FROM (SELECT DISTINCT length_mm, width_mm, height_mm FROM schemes
  WHERE length_mm > 0 AND width_mm > 0 AND height_mm > 0) s
JOIN dictionaries d ON d.code = 'booth_size'
ON CONFLICT (dictionary_id, item_value) DO NOTHING;

CREATE TABLE retired_size_dictionary_backup AS
SELECT to_jsonb(d) AS dictionary, to_jsonb(i) AS item
FROM dictionaries d LEFT JOIN dictionary_items i ON i.dictionary_id = d.id
WHERE d.code IN ('booth_length', 'booth_width', 'booth_height', 'booth_area');

DELETE FROM dictionaries WHERE code IN ('booth_length', 'booth_width', 'booth_height', 'booth_area');

CREATE INDEX dictionary_item_size_idx ON dictionary_items (length_mm, width_mm, height_mm)
WHERE length_mm IS NOT NULL;
