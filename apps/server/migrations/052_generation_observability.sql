-- Correlate HTTP request -> generation job -> provider request for incident tracing.
ALTER TABLE theme_jobs ADD COLUMN request_id text CHECK (request_id IS NULL OR length(request_id) <= 128);
ALTER TABLE artwork_jobs ADD COLUMN request_id text CHECK (request_id IS NULL OR length(request_id) <= 128);
ALTER TABLE theme_job_provider_attempts ADD COLUMN provider_request_id text CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 128);
ALTER TABLE artwork_job_directions ADD COLUMN provider_request_id text CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 128);

-- Phase timing: refreshGeneration keeps the start of the current phase so durations can be logged and monitored.
ALTER TABLE theme_jobs ADD COLUMN phase_started_at timestamptz;
ALTER TABLE artwork_jobs ADD COLUMN phase_started_at timestamptz;
