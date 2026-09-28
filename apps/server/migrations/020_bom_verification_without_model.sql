ALTER TABLE scheme_boms DROP CONSTRAINT scheme_boms_verified_check;
ALTER TABLE scheme_boms ADD CONSTRAINT scheme_boms_verified_check
  CHECK (status <> 'verified' OR verified_at IS NOT NULL);
ALTER TABLE scheme_boms DROP CONSTRAINT scheme_boms_model_same_scheme;
ALTER TABLE scheme_boms
  DROP COLUMN model_asset_id,
  DROP COLUMN model_asset_version_id,
  DROP COLUMN model_hash;
