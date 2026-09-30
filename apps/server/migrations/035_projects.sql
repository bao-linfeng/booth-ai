CREATE SEQUENCE project_number_seq;
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_no text NOT NULL UNIQUE DEFAULT ('PJ-' || lpad(nextval('project_number_seq')::text, 8, '0')),
  request_no text NOT NULL UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('quote_request','manual_request')),
  customer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  assignee_admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  attribution jsonb NOT NULL DEFAULT '{"type":"public"}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','following','quoted','won','lost','closed')),
  revision integer NOT NULL DEFAULT 1,
  scheme_code text,
  request_snapshot jsonb NOT NULL,
  scheme_snapshot jsonb,
  materials_snapshot jsonb NOT NULL DEFAULT '{}',
  public_result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_customer_idx ON projects(customer_user_id, updated_at DESC, id DESC);
CREATE INDEX projects_status_idx ON projects(status, updated_at DESC, id DESC);
CREATE INDEX projects_assignee_idx ON projects(assignee_admin_id, updated_at DESC, id DESC);
CREATE TABLE project_asset_versions (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  asset_version_id uuid NOT NULL REFERENCES asset_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY(project_id, asset_version_id)
);
CREATE TABLE project_operations (
  actor_type text NOT NULL CHECK (actor_type IN ('client','admin')),
  actor_id uuid NOT NULL,
  operation text NOT NULL,
  target text NOT NULL,
  request_key text NOT NULL,
  payload_hash text NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY(actor_type,actor_id,operation,target,request_key)
);
CREATE TABLE project_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  actor_admin_id uuid REFERENCES admins(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_events_project_idx ON project_events(project_id, created_at DESC, id DESC);
CREATE TABLE project_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL UNIQUE REFERENCES project_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
