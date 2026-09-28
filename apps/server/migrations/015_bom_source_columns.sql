ALTER TABLE scheme_bom_items
  ADD COLUMN unit_price numeric(18,6) CHECK (unit_price >= 0),
  ADD COLUMN total_price numeric(18,6) CHECK (total_price >= 0),
  ADD COLUMN total_weight_kg numeric(18,6) CHECK (total_weight_kg >= 0);

ALTER TABLE bom_imports ALTER COLUMN mapping_revision SET DEFAULT 2;
