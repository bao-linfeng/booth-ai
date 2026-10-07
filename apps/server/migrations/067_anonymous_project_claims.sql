-- 未登录访客可提交询价/人工需求：以联系邮箱记录待认领项目，登录后按灵通已验证邮箱自动认领。
ALTER TABLE projects ADD COLUMN claim_email text CHECK (claim_email IS NULL OR (claim_email = lower(claim_email) AND claim_email <> ''));
CREATE INDEX projects_unclaimed_email_idx ON projects(claim_email) WHERE customer_user_id IS NULL AND claim_email IS NOT NULL;

ALTER TABLE project_operations DROP CONSTRAINT project_operations_actor_type_check;
ALTER TABLE project_operations ADD CONSTRAINT project_operations_actor_type_check CHECK (actor_type IN ('client','admin','anonymous'));
