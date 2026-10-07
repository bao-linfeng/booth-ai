-- 069/070 新增的签到奖励配置权限此前没有迁移授予，新环境的 ROLE_ADMIN 缺少该权限。
-- 已拥有该权限的角色不变（revision 不递增），可重复执行。
UPDATE admin_roles
SET permission_codes = ARRAY(
  SELECT DISTINCT code
  FROM unnest(array_append(permission_codes, 'credits.sign_in_config')) AS permissions(code)
  ORDER BY code
), revision = revision + 1, updated_at = now()
WHERE name = 'ROLE_ADMIN' AND NOT ('credits.sign_in_config' = ANY(permission_codes));
