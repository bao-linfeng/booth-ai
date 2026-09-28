ALTER TABLE scheme_bom_items ADD COLUMN measurement_kind text;

UPDATE scheme_bom_items i
SET measurement_kind = r.measurement_kind
FROM scheme_bom_unit_rules r
WHERE i.unit_rule_id = r.id AND i.bom_id = r.bom_id;

UPDATE scheme_bom_items
SET measurement_kind = CASE
  WHEN source_unit IN ('个', '件') THEN 'count'
  WHEN source_unit IN ('mm', 'm') THEN 'length'
  WHEN source_unit IN ('mm2', 'mm²', 'm2', 'm²') THEN 'area'
END
WHERE measurement_kind IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM scheme_bom_items WHERE measurement_kind IS NULL) THEN
    RAISE EXCEPTION 'BOM items without a measurement rule must be resolved before migration';
  END IF;
END $$;

ALTER TABLE scheme_bom_items
  ALTER COLUMN measurement_kind SET NOT NULL,
  ADD CONSTRAINT scheme_bom_items_measurement_kind_check
    CHECK (measurement_kind IN ('count', 'length', 'area'));

DROP INDEX scheme_bom_items_rule_idx;
ALTER TABLE scheme_bom_items
  DROP CONSTRAINT scheme_bom_items_rule_same_bom,
  DROP COLUMN unit_rule_id;
DROP TABLE scheme_bom_unit_rules;
ALTER TABLE scheme_boms DROP COLUMN unit_rules_hash;
ALTER TABLE bom_imports ALTER COLUMN mapping_revision SET DEFAULT 5;
