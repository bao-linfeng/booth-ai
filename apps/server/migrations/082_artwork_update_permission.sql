-- 平面素材新增 update 权限（修改资源名称、墙面位置与尺寸），授予已有上传权限的角色。
-- 已拥有该权限的角色不变（revision 不递增），可重复执行。
UPDATE admin_roles
SET permission_codes = ARRAY(
  SELECT DISTINCT code
  FROM unnest(array_append(permission_codes, 'assets-artworks.update')) AS permissions(code)
  ORDER BY code
), revision = revision + 1, updated_at = now()
WHERE 'assets-artworks.upload' = ANY(permission_codes) AND NOT ('assets-artworks.update' = ANY(permission_codes));
