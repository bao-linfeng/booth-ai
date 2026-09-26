CREATE TABLE scheme_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('model', 'checklist', 'rendering', 'mask', 'drawing', 'artwork')),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  related_asset_id uuid REFERENCES scheme_assets(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES admins(id),
  updated_by uuid REFERENCES admins(id),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheme_assets_scheme_id_idx ON scheme_assets(scheme_id, type) WHERE is_active = true;
CREATE INDEX scheme_assets_type_idx ON scheme_assets(type) WHERE is_active = true;

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES scheme_assets(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  checksum text NOT NULL,
  width_px integer,
  height_px integer,
  page_count integer,
  created_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_versions_asset_id_idx ON asset_versions(asset_id, created_at DESC);
