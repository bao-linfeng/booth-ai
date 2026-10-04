WITH mapping(old_code, new_codes) AS (VALUES
  ('dashboard.read', ARRAY['dashboard.read', 'workspace.read']),
  ('users.read', ARRAY['users.read', 'users.detail']),
  ('credits.write', ARRAY['credits.recharge']),
  ('searches.read', ARRAY['searches.read', 'searches.detail', 'search-analytics.read', 'users.read', 'schemes.read']),
  ('schemes.read', ARRAY['schemes.read', 'schemes.readiness']),
  ('schemes.publish', ARRAY['schemes.publish', 'schemes.unpublish']),
  ('assets.read', ARRAY['assets-renderings.read', 'assets-masks.read', 'assets-drawings.read', 'assets-artworks.read', 'assets-models.read', 'assets-checklists.read']),
  ('assets.write', ARRAY['assets-renderings.upload', 'assets-renderings.replace', 'assets-renderings.update', 'assets-renderings.delete',
    'assets-masks.upload', 'assets-masks.replace', 'assets-masks.update', 'assets-masks.delete',
    'assets-drawings.upload', 'assets-drawings.replace', 'assets-drawings.delete',
    'assets-artworks.upload', 'assets-artworks.replace', 'assets-artworks.delete', 'assets-models.upload',
    'assets-checklists.upload', 'assets-checklists.replace', 'assets-checklists.update', 'assets-checklists.delete']),
  ('assets.download', ARRAY['assets-renderings.preview', 'assets-masks.preview', 'assets-masks.download', 'assets-drawings.download',
    'assets-artworks.download', 'assets-models.download', 'assets-checklists.download']),
  ('bom.write', ARRAY['bom.import', 'bom.update', 'bom.delete-item', 'bom.delete']),
  ('projects.read', ARRAY['projects.read', 'projects.quotation-download', 'projects.asset-download']),
  ('projects.write', ARRAY['projects.assign', 'projects.follow-up', 'projects.link-scheme', 'projects.quotation']),
  ('generation.read', ARRAY['generation.read', 'generation.detail']),
  ('notifications.read', ARRAY['notifications.read', 'notifications.mark-read', 'notifications.mark-all-read']),
  ('dictionaries.write', ARRAY['dictionaries.create', 'dictionaries.update', 'dictionaries.delete', 'dictionaries.item-create', 'dictionaries.item-update', 'dictionaries.item-delete']),
  ('ai-models.write', ARRAY['ai-models.provider-create', 'ai-models.provider-update', 'ai-models.provider-delete', 'ai-models.discover',
    'ai-models.model-create', 'ai-models.model-update', 'ai-models.model-delete', 'ai-models.assign']),
  ('prompts.read', ARRAY['prompts.read', 'schemes.read']),
  ('prompts.write', ARRAY['prompts.create', 'prompts.update', 'prompts.enable', 'prompts.disable', 'prompts.preview']),
  ('questions.write', ARRAY['questions.create', 'questions.update', 'questions.enable', 'questions.disable', 'questions.delete'])
), expanded AS (
  SELECT r.id, ARRAY(
    SELECT DISTINCT replacement.code
    FROM unnest(r.permission_codes) AS existing(code)
    LEFT JOIN mapping m ON m.old_code = existing.code
    CROSS JOIN LATERAL unnest(coalesce(m.new_codes, ARRAY[existing.code])) AS replacement(code)
    ORDER BY replacement.code
  ) AS codes
  FROM admin_roles r
)
UPDATE admin_roles r
SET permission_codes = expanded.codes, revision = r.revision + 1, updated_at = now()
FROM expanded
WHERE r.id = expanded.id AND r.permission_codes IS DISTINCT FROM expanded.codes;
