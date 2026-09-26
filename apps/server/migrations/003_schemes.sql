CREATE TABLE catalog_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(type, key)
);
CREATE INDEX catalog_options_type_idx ON catalog_options(type, sort_order) WHERE enabled = true;

CREATE TABLE schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_code text REFERENCES schemes(code) ON DELETE SET NULL,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  area_sqm numeric,
  opening_count integer,
  opening_directions text[],
  product_line text,
  style text,
  industries text[],
  budget_tier text,
  functional_zones text[],
  key_features text[],
  description text,
  keywords text[],
  source text,
  visual_theme text,
  applicable_conditions jsonb,
  publish_status text NOT NULL DEFAULT 'draft' CHECK (publish_status IN ('draft', 'published', 'unpublished')),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'failed')),
  notes text,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES admins(id),
  updated_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schemes_code_idx ON schemes(code);
CREATE INDEX schemes_publish_status_idx ON schemes(publish_status);
CREATE INDEX schemes_verification_status_idx ON schemes(verification_status);
CREATE INDEX schemes_style_idx ON schemes(style);
CREATE INDEX schemes_product_line_idx ON schemes(product_line);

CREATE TABLE scheme_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'expired')),
  source_filename text NOT NULL,
  preview jsonb NOT NULL DEFAULT '[]',
  summary jsonb NOT NULL DEFAULT '{}',
  committed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheme_imports_status_idx ON scheme_imports(status, expires_at);

INSERT INTO catalog_options (type, key, label, sort_order) VALUES
  ('style', 'modern', '现代简约', 1),
  ('style', 'tech', '科技感', 2),
  ('style', 'luxury', '奢华高端', 3),
  ('style', 'natural', '自然生态', 4),
  ('style', 'industrial', '工业风', 5),
  ('style', 'classic', '经典传统', 6),
  ('style', 'art', '艺术创意', 7),
  ('industry', 'electronics', '消费电子', 1),
  ('industry', 'auto', '汽车交通', 2),
  ('industry', 'medical', '医疗健康', 3),
  ('industry', 'food', '食品饮料', 4),
  ('industry', 'beauty', '美妆护肤', 5),
  ('industry', 'home', '家居家装', 6),
  ('industry', 'sports', '运动户外', 7),
  ('industry', 'finance', '金融服务', 8),
  ('industry', 'education', '教育培训', 9),
  ('industry', 'fashion', '服装时尚', 10),
  ('budget_tier', 'economy', '经济型（5万以下）', 1),
  ('budget_tier', 'standard', '标准型（5-15万）', 2),
  ('budget_tier', 'premium', '高端型（15-30万）', 3),
  ('budget_tier', 'luxury', '奢华型（30万以上）', 4),
  ('product_line', 'island', '岛型展台', 1),
  ('product_line', 'peninsula', '半岛型展台', 2),
  ('product_line', 'inline', '直线型展台', 3),
  ('product_line', 'corner', '角型展台', 4),
  ('opening_direction', 'front', '正面开口', 1),
  ('opening_direction', 'back', '背面开口', 2),
  ('opening_direction', 'left', '左侧开口', 3),
  ('opening_direction', 'right', '右侧开口', 4),
  ('opening_direction', 'front_left', '正面+左侧', 5),
  ('opening_direction', 'front_right', '正面+右侧', 6),
  ('opening_direction', 'three_sides', '三面开口', 7),
  ('opening_direction', 'four_sides', '四面开口（岛型）', 8);
