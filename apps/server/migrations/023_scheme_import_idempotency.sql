ALTER TABLE scheme_imports
  ADD COLUMN commit_request_hash text,
  ADD COLUMN committed_result     jsonb;
