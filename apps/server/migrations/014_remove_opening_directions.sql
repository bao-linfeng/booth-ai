CREATE TABLE scheme_opening_directions_archive (
  scheme_id uuid PRIMARY KEY,
  opening_directions text[] NOT NULL
);

INSERT INTO scheme_opening_directions_archive (scheme_id, opening_directions)
SELECT id, opening_directions FROM schemes WHERE opening_directions IS NOT NULL;

ALTER TABLE schemes DROP COLUMN opening_directions;
