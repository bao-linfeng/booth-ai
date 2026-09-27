CREATE TABLE scheme_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL UNIQUE REFERENCES schemes(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'rejected')),
  source_asset_id uuid REFERENCES scheme_assets(id) ON DELETE SET NULL,
  content_hash text,
  unit_rules_hash text,
  model_asset_id uuid REFERENCES scheme_assets(id) ON DELETE SET NULL,
  model_hash text,
  verified_at timestamptz,
  created_by uuid REFERENCES admins(id),
  updated_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scheme_bom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES scheme_boms(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  product_name text NOT NULL,
  product_model text,
  specification_mm text,
  source_quantity numeric(18,6) NOT NULL,
  source_unit text NOT NULL,
  quantity numeric(18,6) NOT NULL,
  unit_rule_id uuid,
  erp_code text,
  source_sheet text,
  source_row integer,
  diff_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bom_id, ordinal)
);

CREATE TABLE scheme_bom_unit_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES scheme_boms(id) ON DELETE CASCADE,
  measurement_kind text NOT NULL CHECK (measurement_kind IN ('count', 'length', 'area')),
  source_unit text NOT NULL,
  pricing_unit text NOT NULL,
  conversion_code text NOT NULL CHECK (conversion_code IN ('identity', 'mm_to_m', 'mm2_to_m2')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scheme_bom_items
  ADD CONSTRAINT scheme_bom_items_unit_rule_id_fkey
  FOREIGN KEY (unit_rule_id) REFERENCES scheme_bom_unit_rules(id) ON DELETE RESTRICT;

CREATE TABLE bom_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  created_by uuid REFERENCES admins(id),
  source_hash text NOT NULL,
  source_filename text NOT NULL,
  mapping_revision integer NOT NULL DEFAULT 1,
  base_revision integer NOT NULL DEFAULT 0,
  preview jsonb NOT NULL DEFAULT '{}',
  errors jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  can_commit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'invalid', 'committed', 'expired')),
  committed_revision integer,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bom_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES scheme_boms(id) ON DELETE CASCADE,
  request_key text NOT NULL UNIQUE,
  content_revision integer NOT NULL,
  resulting_revision integer,
  content_hash text,
  model_hash text,
  model_asset_id uuid REFERENCES scheme_assets(id) ON DELETE SET NULL,
  checks jsonb NOT NULL DEFAULT '{}',
  decision text NOT NULL CHECK (decision IN ('pass', 'reject')),
  notes text,
  admin_id uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scheme_boms_scheme_id_idx ON scheme_boms(scheme_id);
CREATE INDEX bom_imports_scheme_id_idx ON bom_imports(scheme_id);
CREATE INDEX bom_imports_expires_idx ON bom_imports(expires_at) WHERE status = 'ready';
CREATE INDEX bom_verifications_bom_id_idx ON bom_verifications(bom_id, created_at DESC);
