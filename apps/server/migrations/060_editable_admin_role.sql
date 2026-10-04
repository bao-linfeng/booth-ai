INSERT INTO admin_roles (id, name, permission_codes)
VALUES (5, 'ROLE_ADMIN', ARRAY[
  'dashboard.read', 'users.read', 'admins.read', 'roles.read', 'roles.write',
  'credits.read', 'credits.write', 'searches.read',
  'schemes.read', 'schemes.create', 'schemes.update', 'schemes.delete',
  'schemes.import', 'schemes.review', 'schemes.publish',
  'assets.read', 'assets.write', 'assets.download',
  'bom.read', 'bom.write', 'bom.verify', 'bom.download',
  'projects.read', 'projects.write', 'generation.read', 'notifications.read',
  'dictionaries.read', 'dictionaries.write', 'ai-models.read', 'ai-models.write',
  'prompts.read', 'prompts.write', 'questions.read', 'questions.write', 'audit.read'
])
ON CONFLICT (name) DO UPDATE SET
  permission_codes = EXCLUDED.permission_codes,
  revision = admin_roles.revision + 1,
  updated_at = now();
