ALTER TABLE theme_jobs ADD COLUMN execution_deadline timestamptz;
ALTER TABLE artwork_jobs ADD COLUMN execution_deadline timestamptz;

UPDATE theme_jobs SET execution_deadline = updated_at + interval '30 minutes'
  WHERE status IN ('running', 'settling');
UPDATE artwork_jobs SET execution_deadline = updated_at + interval '30 minutes'
  WHERE status IN ('running', 'settling');

CREATE TABLE theme_job_provider_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES theme_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'gemini', 'wanx')),
  model text NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL CHECK (status IN ('submitting', 'waiting', 'succeeded', 'failed', 'unknown')),
  provider_task_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX theme_job_provider_attempts_job_idx ON theme_job_provider_attempts(job_id, created_at);

INSERT INTO theme_job_provider_attempts(id, job_id, provider, model, revision, status, reason)
SELECT gen_random_uuid(), j.id,
  COALESCE(j.generation_snapshot->'models'->0->>'provider', 'openai'),
  COALESCE(j.generation_snapshot->'models'->0->>'model', 'legacy-unknown'),
  COALESCE((j.generation_snapshot->'models'->0->>'revision')::integer, 1),
  'unknown', 'PROVIDER_OUTCOME_UNKNOWN'
FROM theme_jobs j WHERE j.status IN ('running', 'settling')
  AND NOT EXISTS (SELECT 1 FROM theme_job_generated_urls u WHERE u.job_id = j.id);
CREATE INDEX theme_jobs_execution_deadline_idx ON theme_jobs(execution_deadline)
  WHERE status IN ('running', 'settling');
CREATE INDEX artwork_jobs_execution_deadline_idx ON artwork_jobs(execution_deadline)
  WHERE status IN ('running', 'settling');
