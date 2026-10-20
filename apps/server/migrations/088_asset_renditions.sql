-- 展示用衍生图（缩略图、预览图，WebP），由 modules/media 生成；为空表示尚未生成，接口回退为原图
ALTER TABLE asset_versions
  ADD COLUMN renditions jsonb,
  ADD COLUMN rendition_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN rendition_attempted_at timestamptz;

-- Worker 补齐任务按新到旧领取待生成的图片版本
CREATE INDEX asset_versions_rendition_pending_idx ON asset_versions (created_at DESC, id)
  WHERE renditions IS NULL AND rendition_attempts < 3 AND byte_size > 0 AND mime_type IN ('image/png', 'image/jpeg', 'image/webp');
