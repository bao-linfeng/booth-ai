-- Project notification delivery: leased claims, bounded retries, terminal failure kept for manual follow-up.
ALTER TABLE project_notification_outbox
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  ADD COLUMN failed_at timestamptz;
CREATE INDEX project_notification_outbox_pending_idx ON project_notification_outbox(next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
