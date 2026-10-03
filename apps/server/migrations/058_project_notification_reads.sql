-- Admin inbox for project notifications: per-admin read state, independent from external channel delivery.
CREATE TABLE project_notification_reads (
  notification_id uuid NOT NULL REFERENCES project_notification_outbox(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, notification_id)
);
CREATE INDEX project_notification_outbox_created_idx ON project_notification_outbox(created_at DESC, id DESC);
