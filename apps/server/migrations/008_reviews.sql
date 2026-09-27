CREATE TABLE scheme_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  request_key text NOT NULL UNIQUE,
  scheme_revision integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('asset_verification', 'overall')),
  decision text NOT NULL CHECK (decision IN ('pass', 'reject')),
  checks jsonb NOT NULL DEFAULT '{}',
  notes text,
  admin_id uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scheme_reviews_scheme_id_idx ON scheme_reviews(scheme_id, created_at DESC);
CREATE INDEX scheme_reviews_request_key_idx ON scheme_reviews(request_key);
