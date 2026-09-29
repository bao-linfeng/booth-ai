UPDATE scheme_assets a
SET is_active = true,
    revision = a.revision + 1,
    updated_at = now()
FROM scheme_boms b
WHERE b.source_asset_id = a.id
  AND a.type = 'checklist'
  AND a.is_active = false;

WITH ordered_renderings AS (
  SELECT id,
         (row_number() OVER (PARTITION BY scheme_id ORDER BY created_at, id) - 1)::integer AS next_sort_order
  FROM scheme_assets
  WHERE type = 'rendering'
    AND is_active = true
)
UPDATE scheme_assets a
SET sort_order = r.next_sort_order,
    revision = a.revision + 1,
    updated_at = now()
FROM ordered_renderings r
WHERE a.id = r.id;

UPDATE scheme_assets mask
SET sort_order = rendering.sort_order,
    revision = mask.revision + 1,
    updated_at = now()
FROM scheme_assets rendering
WHERE mask.type = 'mask'
  AND mask.is_active = true
  AND mask.related_asset_id = rendering.id
  AND rendering.type = 'rendering'
  AND rendering.is_active = true;

UPDATE schemes
SET applicable_conditions = jsonb_build_object(
      'status', 'confirmed',
      'rules', '[]'::jsonb,
      'labelsConfirmed', true,
      'publicNotes', ''
    ),
    revision = revision + 1,
    verification_status = 'unverified',
    updated_at = now()
WHERE code = 'TW36_BK_025_APP'
  AND applicable_conditions IS NULL;
