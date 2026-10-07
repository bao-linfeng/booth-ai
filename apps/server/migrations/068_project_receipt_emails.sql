-- 询价/人工需求受理回执邮件：与项目同事务写入，Worker 租约投递、有限重试，终态失败保留待人工处理。
CREATE TABLE project_receipt_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
  recipient text NOT NULL CHECK (recipient <> '' AND length(recipient) <= 254),
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2}$'),
  account_bound boolean NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  failed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_receipt_emails_pending_idx ON project_receipt_emails(next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
-- 按收件人限频，防止匿名提交被用来向任意邮箱批量发信
CREATE INDEX project_receipt_emails_recipient_idx ON project_receipt_emails(lower(recipient), created_at DESC);
