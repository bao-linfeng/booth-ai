CREATE TYPE theme_job_status AS ENUM (
  'pending', 'queued', 'running', 'settling',
  'succeeded', 'partially_succeeded', 'failed'
);

CREATE TABLE theme_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  scheme_code       text NOT NULL,
  source_asset_id   uuid NOT NULL,
  offer_id          text NOT NULL,
  request_key       text NOT NULL,
  input             jsonb NOT NULL,
  requested_count   integer NOT NULL CHECK (requested_count BETWEEN 1 AND 4),
  cache_mode        text NOT NULL DEFAULT 'reuse' CHECK (cache_mode IN ('reuse','refresh')),
  status            theme_job_status NOT NULL DEFAULT 'pending',
  phase             text,
  usable_count      integer NOT NULL DEFAULT 0,
  selected_result_id uuid,
  selection_revision integer NOT NULL DEFAULT 0,
  unit_credits      integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_jobs_user_request_key_unique UNIQUE (user_id, request_key)
);

CREATE INDEX theme_jobs_user_id_idx ON theme_jobs (user_id);
CREATE INDEX theme_jobs_scheme_code_idx ON theme_jobs (scheme_code);
