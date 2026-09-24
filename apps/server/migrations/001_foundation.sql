CREATE TABLE foundation_tasks (
  id uuid PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind = 'system.echo'),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE foundation_outbox (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL UNIQUE REFERENCES foundation_tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX foundation_outbox_pending_idx ON foundation_outbox(created_at) WHERE published_at IS NULL;
