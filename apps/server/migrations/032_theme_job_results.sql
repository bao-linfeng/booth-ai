CREATE TABLE theme_job_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES theme_jobs(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  asset_id    text NOT NULL,
  preview_url text,
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_job_results_job_ordinal_unique UNIQUE (job_id, ordinal)
);

CREATE INDEX theme_job_results_job_id_idx ON theme_job_results (job_id);

CREATE TABLE theme_job_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES theme_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  picked_at  timestamptz,
  CONSTRAINT theme_job_outbox_job_unique UNIQUE (job_id)
);

CREATE INDEX theme_job_outbox_pending_idx ON theme_job_outbox (created_at) WHERE picked_at IS NULL;
