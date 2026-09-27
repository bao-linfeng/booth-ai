ALTER TABLE bom_imports
  ADD COLUMN source_object_key text,
  ADD COLUMN commit_request_hash text,
  ADD COLUMN committed_result jsonb,
  ADD CONSTRAINT bom_imports_commit_result_check CHECK (status <> 'committed' OR (committed_revision IS NOT NULL AND commit_request_hash IS NOT NULL AND committed_result IS NOT NULL)),
  ADD CONSTRAINT bom_imports_base_revision_check CHECK (base_revision >= 0);

ALTER TABLE bom_verifications
  ADD COLUMN request_hash text,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN model_asset_version_id uuid REFERENCES asset_versions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bom_verifications_revisions_check CHECK (content_revision >= 1 AND resulting_revision > content_revision);

ALTER TABLE scheme_boms
  ADD COLUMN model_asset_version_id uuid REFERENCES asset_versions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT scheme_boms_revision_check CHECK (revision >= 1),
  ADD CONSTRAINT scheme_boms_verified_check CHECK (status <> 'verified' OR (verified_at IS NOT NULL AND model_asset_id IS NOT NULL AND model_asset_version_id IS NOT NULL));

ALTER TABLE scheme_bom_items
  ADD CONSTRAINT scheme_bom_items_ordinal_check CHECK (ordinal > 0),
  ADD CONSTRAINT scheme_bom_items_source_row_check CHECK (source_row IS NULL OR source_row > 0),
  ADD CONSTRAINT scheme_bom_items_quantity_check CHECK (source_quantity > 0 AND quantity > 0),
  ADD CONSTRAINT scheme_bom_items_name_check CHECK (length(btrim(product_name)) > 0),
  ADD CONSTRAINT scheme_bom_items_unit_check CHECK (length(btrim(source_unit)) > 0);

ALTER TABLE scheme_bom_unit_rules
  ADD CONSTRAINT scheme_bom_unit_rules_units_check CHECK (length(btrim(source_unit)) > 0 AND length(btrim(pricing_unit)) > 0),
  ADD CONSTRAINT scheme_bom_unit_rules_conversion_check CHECK (
    (conversion_code = 'identity' AND source_unit = pricing_unit)
    OR (measurement_kind = 'length' AND conversion_code = 'mm_to_m' AND source_unit = 'mm' AND pricing_unit = 'm')
    OR (measurement_kind = 'area' AND conversion_code = 'mm2_to_m2' AND source_unit IN ('mm2', 'mm²') AND pricing_unit IN ('m2', 'm²'))
  );

ALTER TABLE scheme_bom_unit_rules ADD CONSTRAINT scheme_bom_unit_rules_bom_id_id_unique UNIQUE (bom_id, id);
ALTER TABLE scheme_bom_items DROP CONSTRAINT scheme_bom_items_unit_rule_id_fkey;
ALTER TABLE scheme_bom_items ADD CONSTRAINT scheme_bom_items_rule_same_bom FOREIGN KEY (bom_id, unit_rule_id) REFERENCES scheme_bom_unit_rules(bom_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX scheme_bom_unit_rules_source_unique ON scheme_bom_unit_rules(bom_id, source_unit);
CREATE INDEX scheme_bom_items_rule_idx ON scheme_bom_items(unit_rule_id) WHERE unit_rule_id IS NOT NULL;
DROP INDEX scheme_boms_scheme_id_idx;

ALTER TABLE scheme_assets ADD CONSTRAINT scheme_assets_scheme_id_id_unique UNIQUE (scheme_id, id);
ALTER TABLE scheme_boms ADD CONSTRAINT scheme_boms_source_same_scheme FOREIGN KEY (scheme_id, source_asset_id) REFERENCES scheme_assets(scheme_id, id);
ALTER TABLE scheme_boms ADD CONSTRAINT scheme_boms_model_same_scheme FOREIGN KEY (scheme_id, model_asset_id) REFERENCES scheme_assets(scheme_id, id);

CREATE TABLE bom_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES scheme_boms(id) ON DELETE CASCADE,
  before_revision integer NOT NULL CHECK (before_revision >= 0),
  after_revision integer NOT NULL CHECK (after_revision > before_revision),
  action text NOT NULL CHECK (action IN ('import', 'items', 'unit_rules', 'verification', 'model_invalidated')),
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) > 0),
  admin_id uuid NOT NULL REFERENCES admins(id),
  summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bom_change_logs_bom_idx ON bom_change_logs(bom_id, created_at DESC);
