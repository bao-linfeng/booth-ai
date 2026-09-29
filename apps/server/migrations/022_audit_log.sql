CREATE TABLE admin_audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid        NOT NULL REFERENCES admins(id),
  action      text        NOT NULL,
  target_type text        NOT NULL,
  target_id   text        NOT NULL,
  detail      jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_logs_admin_idx  ON admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX admin_audit_logs_target_idx ON admin_audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);
