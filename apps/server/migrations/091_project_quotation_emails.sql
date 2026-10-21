-- 报价邮件：保存报价修订并选择发送时与项目同事务写入，Worker 租约投递（附报价单），有限重试，终态失败保留待人工重新发送。
CREATE TABLE project_quotation_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  quotation_revision integer NOT NULL,
  recipient text NOT NULL CHECK (recipient <> '' AND length(recipient) <= 254),
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2}$'),
  requested_by uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  failed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, quotation_revision) REFERENCES project_quotation_revisions(project_id, revision) ON DELETE RESTRICT
);
CREATE INDEX project_quotation_emails_pending_idx ON project_quotation_emails(next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
CREATE INDEX project_quotation_emails_project_idx ON project_quotation_emails(project_id, created_at DESC);
