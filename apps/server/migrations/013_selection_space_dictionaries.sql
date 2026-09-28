INSERT INTO dictionaries (code, name, type) VALUES
  ('opening_count', '开口面数', 'selection'),
  ('booth_length', '展位长', 'selection'),
  ('booth_width', '展位宽', 'selection'),
  ('booth_height', '展位高', 'selection'),
  ('booth_area', '展位面积', 'selection')
ON CONFLICT (code) DO NOTHING;

INSERT INTO dictionary_items (dictionary_id, item_value, item_label, sort_order)
SELECT d.id, s.item_value, s.item_label, s.sort_order
FROM (
  SELECT 'opening_count'::text AS code, opening_count::text AS item_value,
    CASE WHEN opening_count = 4 THEN '4面开口（岛式）' ELSE opening_count::text || '面开口' END AS item_label,
    opening_count::integer AS sort_order
  FROM schemes WHERE opening_count IS NOT NULL
  UNION
  SELECT 'booth_length'::text, length_mm::text, (length_mm::numeric / 1000)::text || ' m', length_mm::integer
  FROM schemes WHERE length_mm IS NOT NULL
  UNION
  SELECT 'booth_width'::text, width_mm::text, (width_mm::numeric / 1000)::text || ' m', width_mm::integer
  FROM schemes WHERE width_mm IS NOT NULL
  UNION
  SELECT 'booth_height'::text, height_mm::text, (height_mm::numeric / 1000)::text || ' m', height_mm::integer
  FROM schemes WHERE height_mm IS NOT NULL
  UNION
  SELECT 'booth_area', area_sqm::text, area_sqm::text || ' ㎡', round(area_sqm)::integer
  FROM schemes WHERE area_sqm IS NOT NULL
) s
JOIN dictionaries d ON d.code = s.code
ON CONFLICT (dictionary_id, item_value) DO NOTHING;
