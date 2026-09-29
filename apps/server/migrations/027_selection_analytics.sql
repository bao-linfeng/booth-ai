CREATE TABLE selection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX selection_attempts_visitor_idx ON selection_attempts(visitor_id, created_at DESC);
CREATE INDEX selection_attempts_user_idx ON selection_attempts(user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE selection_parses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES selection_attempts(id) ON DELETE CASCADE,
  visitor_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  input_text text NOT NULL,
  form_requirement jsonb NOT NULL,
  final_requirement jsonb NOT NULL,
  parser text NOT NULL CHECK (parser IN ('llm', 'rules', 'none')),
  degraded boolean NOT NULL,
  field_sources jsonb NOT NULL,
  overrides jsonb NOT NULL,
  clarifications jsonb NOT NULL,
  unhandled_text text[] NOT NULL DEFAULT '{}',
  warnings jsonb NOT NULL DEFAULT '[]',
  rules_version text NOT NULL,
  dictionary_version text NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX selection_parses_attempt_idx ON selection_parses(attempt_id, created_at DESC);
CREATE INDEX selection_parses_created_idx ON selection_parses(created_at DESC);
CREATE INDEX selection_parses_degraded_idx ON selection_parses(degraded, created_at DESC);

CREATE TABLE selection_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES selection_attempts(id) ON DELETE CASCADE,
  parse_id uuid REFERENCES selection_parses(id) ON DELETE SET NULL,
  visitor_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('random', 'filtered')),
  status text NOT NULL CHECK (status IN ('matched', 'no_match', 'needs_clarification')),
  input_text text NOT NULL DEFAULT '',
  final_requirement jsonb NOT NULL,
  direct_count integer NOT NULL DEFAULT 0 CHECK (direct_count >= 0),
  reference_count integer NOT NULL DEFAULT 0 CHECK (reference_count >= 0),
  random_count integer NOT NULL DEFAULT 0 CHECK (random_count >= 0),
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  zero_match_reasons text[] NOT NULL DEFAULT '{}',
  demand_terms text[] NOT NULL DEFAULT '{}',
  result_snapshot jsonb NOT NULL DEFAULT '[]',
  rules_version text NOT NULL,
  dictionary_version text NOT NULL,
  degraded_parse boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX selection_searches_created_idx ON selection_searches(created_at DESC);
CREATE INDEX selection_searches_attempt_idx ON selection_searches(attempt_id, created_at DESC);
CREATE INDEX selection_searches_visitor_idx ON selection_searches(visitor_id, created_at DESC);
CREATE INDEX selection_searches_user_idx ON selection_searches(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX selection_searches_status_idx ON selection_searches(status, created_at DESC);
