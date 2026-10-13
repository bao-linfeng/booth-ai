-- 四向底图生图的全局设置（单行）。提交任务时冻结进 generation_snapshot.options，修改只影响新任务。
-- drawing_directions：哪些方向附带方案报馆图（俯视图 + 本方向立面，背面/右侧用正视图/左视图翻转）校正结构，空数组即不使用报馆图；
-- drawing_grayscale：报馆图去色后发送，避免旧方案的品牌配色被带进结果。
CREATE TABLE artwork_generation_settings (
  id                 boolean PRIMARY KEY DEFAULT TRUE,
  drawing_directions text[] NOT NULL DEFAULT ARRAY['front', 'back', 'left', 'right']
    CHECK (drawing_directions <@ ARRAY['front', 'back', 'left', 'right']),
  drawing_grayscale  boolean NOT NULL DEFAULT TRUE,
  revision           integer NOT NULL DEFAULT 1,
  updated_by         uuid REFERENCES admins(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artwork_generation_settings_singleton CHECK (id = TRUE)
);

INSERT INTO artwork_generation_settings (id) VALUES (TRUE);

-- 报馆图视向由「正/顶/侧」改为「正/左/俯」（front/left/top）。SketchUp 标准三视图导出的侧视图为左视图，原 side 统一改为 left。
UPDATE scheme_assets
SET metadata = jsonb_set(
  metadata,
  '{viewCodes}',
  (SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN code = 'side' THEN 'left' ELSE code END), '[]'::jsonb)
   FROM jsonb_array_elements_text(metadata->'viewCodes') AS codes(code))
)
WHERE type = 'drawing' AND jsonb_typeof(metadata->'viewCodes') = 'array' AND metadata->'viewCodes' ? 'side';

-- 报馆图新增 update 权限（修改名称与视向），授予已有上传权限的角色。已拥有的角色不变，可重复执行。
UPDATE admin_roles
SET permission_codes = ARRAY(
  SELECT DISTINCT code
  FROM unnest(array_append(permission_codes, 'assets-drawings.update')) AS permissions(code)
  ORDER BY code
), revision = revision + 1, updated_at = now()
WHERE 'assets-drawings.upload' = ANY(permission_codes) AND NOT ('assets-drawings.update' = ANY(permission_codes));
