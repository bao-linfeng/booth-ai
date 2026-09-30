CREATE TYPE artwork_job_status AS ENUM (
  'pending', 'queued', 'running', 'settling',
  'succeeded', 'partially_succeeded', 'failed'
);

-- 四面平面素材生成任务
-- artwork_key: front | back | left | right，对应展台四个方向的平面图
CREATE TABLE artwork_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  scheme_code       text NOT NULL,
  source_asset_id   uuid NOT NULL,
  artwork_key       text NOT NULL CHECK (artwork_key IN ('front', 'back', 'left', 'right')),
  offer_id          text NOT NULL,
  request_key       text NOT NULL,
  input             jsonb NOT NULL,
  requested_count   integer NOT NULL CHECK (requested_count BETWEEN 1 AND 4),
  cache_mode        text NOT NULL DEFAULT 'reuse' CHECK (cache_mode IN ('reuse','refresh')),
  status            artwork_job_status NOT NULL DEFAULT 'pending',
  phase             text,
  usable_count      integer NOT NULL DEFAULT 0,
  selected_result_id uuid,
  selection_revision integer NOT NULL DEFAULT 0,
  unit_credits      integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artwork_jobs_user_request_key_unique UNIQUE (user_id, request_key)
);

CREATE INDEX artwork_jobs_user_id_idx ON artwork_jobs (user_id);
CREATE INDEX artwork_jobs_scheme_code_idx ON artwork_jobs (scheme_code);

-- 生成结果表（每条对应一张生成图）
CREATE TABLE artwork_job_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES artwork_jobs(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  asset_id    uuid NOT NULL,
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artwork_job_results_job_ordinal_unique UNIQUE (job_id, ordinal)
);

CREATE INDEX artwork_job_results_job_id_idx ON artwork_job_results (job_id);

-- Outbox：保证任务入库与入队在同一事务
CREATE TABLE artwork_job_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES artwork_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  picked_at  timestamptz,
  CONSTRAINT artwork_job_outbox_job_unique UNIQUE (job_id)
);

CREATE INDEX artwork_job_outbox_pending_idx ON artwork_job_outbox (created_at) WHERE picked_at IS NULL;
