ALTER TABLE scheme_assets
  ADD COLUMN source text NOT NULL DEFAULT 'scheme',
  ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN visibility text NOT NULL DEFAULT 'public';

WITH origins AS (
  SELECT r.asset_id, 'theme_generation' AS source, j.user_id
  FROM theme_job_results r JOIN theme_jobs j ON j.id = r.job_id
  UNION ALL
  SELECT r.asset_id, 'artwork_generation', j.user_id
  FROM artwork_job_results r JOIN artwork_jobs j ON j.id = r.job_id
), ownership AS (
  SELECT asset_id,
    CASE WHEN bool_or(source = 'artwork_generation') THEN 'artwork_generation' ELSE 'theme_generation' END AS source,
    CASE WHEN count(DISTINCT user_id) = 1 THEN min(user_id::text)::uuid ELSE NULL END AS user_id
  FROM origins GROUP BY asset_id
)
UPDATE scheme_assets a
SET source = o.source, owner_user_id = o.user_id, visibility = 'private'
FROM ownership o WHERE a.id = o.asset_id;

UPDATE scheme_assets a
SET source = CASE WHEN a.metadata ? 'artworkJobId' THEN 'artwork_generation' ELSE 'theme_generation' END,
    owner_user_id = CASE WHEN a.metadata ? 'artworkJobId' THEN
      (SELECT j.user_id FROM artwork_jobs j WHERE j.id::text = a.metadata->>'artworkJobId')
    ELSE
      (SELECT j.user_id FROM theme_jobs j WHERE j.id::text = a.metadata->>'themeJobId') END,
    visibility = 'private'
WHERE a.source = 'scheme' AND (a.metadata ? 'themeJobId' OR a.metadata ? 'artworkJobId');

ALTER TABLE scheme_assets
  ADD CONSTRAINT scheme_assets_source_check CHECK (source IN ('scheme', 'theme_generation', 'artwork_generation')),
  ADD CONSTRAINT scheme_assets_visibility_check CHECK (visibility IN ('public', 'private')),
  ADD CONSTRAINT scheme_assets_scope_check CHECK (
    (source = 'scheme' AND visibility = 'public' AND owner_user_id IS NULL) OR
    (source IN ('theme_generation', 'artwork_generation') AND visibility = 'private')
  );

CREATE INDEX scheme_assets_baseline_idx ON scheme_assets(scheme_id, type, sort_order)
  WHERE source = 'scheme' AND visibility = 'public' AND owner_user_id IS NULL;
CREATE INDEX scheme_assets_owner_idx ON scheme_assets(owner_user_id, source)
  WHERE visibility = 'private';

CREATE VIEW scheme_baseline_assets AS
  SELECT * FROM scheme_assets
  WHERE source = 'scheme' AND visibility = 'public' AND owner_user_id IS NULL
  WITH CASCADED CHECK OPTION;
