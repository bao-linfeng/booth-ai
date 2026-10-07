UPDATE admin_roles
SET permission_codes = ARRAY(
  SELECT DISTINCT code
  FROM unnest(array_replace(permission_codes, 'credits.sign-in-config', 'credits.sign_in_config')) AS permissions(code)
  ORDER BY code
), revision = revision + 1, updated_at = now()
WHERE 'credits.sign-in-config' = ANY(permission_codes);
