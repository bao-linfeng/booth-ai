CREATE TABLE imported_dimension_orientation_backup AS
WITH imported AS (
  SELECT DISTINCT ON (row->>'code') row->>'code' AS code, row->'data' AS data
  FROM scheme_imports i CROSS JOIN LATERAL jsonb_array_elements(i.preview) row
  WHERE i.status = 'committed' AND i.source_filename = '灵通展台方案打标模板.xlsx'
    AND row->>'status' IN ('valid','duplicate') AND row->'data' IS NOT NULL
  ORDER BY row->>'code', i.committed_at DESC, i.id DESC
)
SELECT s.* FROM schemes s JOIN imported i ON i.code = s.code
WHERE s.length_mm <> s.width_mm
  AND s.length_mm::text = i.data->>'lengthMm'
  AND s.width_mm::text = i.data->>'widthMm'
  AND s.height_mm::text = i.data->>'heightMm';

UPDATE schemes s SET length_mm = b.width_mm, width_mm = b.length_mm,
  revision = s.revision + 1, updated_at = now(), verification_status = 'unverified',
  publish_status = CASE WHEN s.publish_status = 'published' THEN 'draft' ELSE s.publish_status END
FROM imported_dimension_orientation_backup b WHERE s.id = b.id;

INSERT INTO dictionary_items (dictionary_id, item_value, item_label, length_mm, width_mm, height_mm)
SELECT d.id, s.length_mm::text || '-' || s.width_mm::text || '-' || s.height_mm::text,
  trim_scale(s.length_mm::numeric / 1000)::text || ' × ' || trim_scale(s.width_mm::numeric / 1000)::text
    || ' × ' || trim_scale(s.height_mm::numeric / 1000)::text || ' m',
  s.length_mm, s.width_mm, s.height_mm
FROM (SELECT DISTINCT length_mm, width_mm, height_mm FROM schemes
  WHERE length_mm > 0 AND width_mm > 0 AND height_mm > 0) s
JOIN dictionaries d ON d.code = 'booth_size'
ON CONFLICT (dictionary_id, item_value) DO NOTHING;

UPDATE scheme_imports SET status = 'expired' WHERE status = 'pending';
