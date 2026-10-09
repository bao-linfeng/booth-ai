-- 效果图软删除不会触发 related_asset_id 的 ON DELETE SET NULL，历史上删除效果图后其活动蒙版仍指向已失效的效果图。
-- 解除这些失效配对，蒙版以“未配对”状态保留，由管理端重新配对或删除。
UPDATE scheme_assets m
SET related_asset_id = NULL, revision = m.revision + 1, updated_at = now()
FROM scheme_assets r
WHERE m.related_asset_id = r.id AND m.type = 'mask' AND m.is_active = true AND r.is_active = false;
