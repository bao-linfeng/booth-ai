ALTER TABLE theme_jobs ADD COLUMN search_id uuid REFERENCES selection_searches(id) ON DELETE SET NULL;

UPDATE theme_jobs j SET search_id = (
  SELECT s.id FROM selection_searches s
  WHERE s.user_id = j.user_id AND s.status = 'matched' AND s.created_at <= j.created_at
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.result_snapshot) item WHERE item->>'code' = j.scheme_code)
  ORDER BY s.created_at DESC, s.id DESC LIMIT 1
);

CREATE INDEX theme_jobs_search_idx ON theme_jobs(search_id, scheme_code, created_at DESC, id DESC)
  WHERE search_id IS NOT NULL;
