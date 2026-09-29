CREATE TABLE manual_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  contact_name text NOT NULL,
  contact_detail text NOT NULL,
  original_text text NOT NULL,
  requirement jsonb NOT NULL,
  unresolved_questions jsonb NOT NULL,
  scheme_context jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'following_up', 'completed')),
  follow_up_note text NOT NULL DEFAULT '',
  followed_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX manual_requests_status_created_idx ON manual_requests (status, created_at DESC);
