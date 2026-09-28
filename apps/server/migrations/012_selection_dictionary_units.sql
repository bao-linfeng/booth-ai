DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schemes WHERE
      (length_cm IS NOT NULL AND (length_cm <= 0 OR length_cm * 10 <> trunc(length_cm * 10) OR length_cm * 10 > 2147483647)) OR
      (width_cm IS NOT NULL AND (width_cm <= 0 OR width_cm * 10 <> trunc(width_cm * 10) OR width_cm * 10 > 2147483647)) OR
      (height_cm IS NOT NULL AND (height_cm <= 0 OR height_cm * 10 <> trunc(height_cm * 10) OR height_cm * 10 > 2147483647))
  ) THEN RAISE EXCEPTION 'Scheme dimensions cannot be represented as positive integer millimeters; inspect schemes before migration'; END IF;
END $$;

INSERT INTO dictionaries (code, name, type) VALUES
  ('product_system', '产品体系', 'selection'),
  ('style', '风格', 'selection'),
  ('industry', '适用行业', 'selection'),
  ('budget_tier', '预算档位', 'selection'),
  ('functional_zone', '功能分区', 'selection'),
  ('key_feature', '关键特征', 'selection')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dictionaries WHERE code IN ('product_system','style','industry','budget_tier','functional_zone','key_feature') AND type IS DISTINCT FROM 'selection') THEN
    RAISE EXCEPTION 'Selection dictionary code conflicts with an existing dictionary';
  END IF;
END $$;

WITH seeds(code, value, label, sort_order) AS (VALUES
  ('product_system','fs62_fabric','FS62布框',1), ('product_system','aluminum_frame','铝合金框',2),
  ('product_system','truss','桁架',3), ('product_system','lightbox_wall','灯箱墙',4),
  ('product_system','art_square_wall','艺四方墙',5), ('product_system','hybrid','混合',6),
  ('style','modern','现代简约',1), ('style','natural','自然环保',2), ('style','technology','科技未来',3),
  ('style','new_chinese','新中式',4), ('style','light_luxury','轻奢',5), ('style','industrial','工业风',6),
  ('style','warm','暖色温馨',7), ('style','monochrome','极简黑白',8), ('style','business_cool','商务冷色',9),
  ('style','gallery_white','美术馆白',10), ('style','trendy','潮流活力',11),
  ('industry','electronics','消费电子',1), ('industry','building_home','建材家居',2),
  ('industry','jewelry','珠宝钟表',3), ('industry','auto','汽车',4), ('industry','food','食品饮料',5),
  ('industry','medical','医药健康',6), ('industry','fashion','服装纺织',7),
  ('industry','arts','文化艺术',8), ('industry','general','通用',9),
  ('industry','hardware','五金电器',10), ('industry','baby','婴童用品',11),
  ('industry','beauty','护肤美妆',12),
  ('budget_tier','low','低(3万以内)',1), ('budget_tier','medium','中(3-8万)',2),
  ('budget_tier','high','高(8万以上)',3),
  ('functional_zone','reception','接待区',1), ('functional_zone','display','展示区',2),
  ('functional_zone','negotiation','洽谈区',3), ('functional_zone','storage','储藏间',4),
  ('functional_zone','brand_wall','品牌墙',5), ('functional_zone','product_display','产品陈列区',6),
  ('key_feature','storage','储藏间',1), ('key_feature','symmetry','对称',2),
  ('key_feature','shelf','层板架',3), ('key_feature','display_platform','展示台',4),
  ('key_feature','display_case','展示柜',5), ('key_feature','arc','弧形',6),
  ('key_feature','arc_element','弧形元素',7), ('key_feature','light_strip','灯带',8),
  ('key_feature','lightbox','灯箱',9), ('key_feature','television','电视机',10)
)
INSERT INTO dictionary_items (dictionary_id, item_value, item_label, sort_order)
SELECT d.id, s.value, s.label, s.sort_order FROM seeds s JOIN dictionaries d ON d.code = s.code
ON CONFLICT (dictionary_id, item_value) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
    WHERE d.code IN ('product_system','style','industry','budget_tier','functional_zone','key_feature')
    GROUP BY d.code, i.item_label HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Duplicate selection dictionary labels; resolve before migration'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT 'product_system' code, product_line value FROM schemes WHERE product_line IS NOT NULL
      UNION ALL SELECT 'style', style FROM schemes WHERE style IS NOT NULL
      UNION ALL SELECT 'budget_tier', budget_tier FROM schemes WHERE budget_tier IS NOT NULL
      UNION ALL SELECT 'industry', unnest(industries) FROM schemes
      UNION ALL SELECT 'functional_zone', unnest(functional_zones) FROM schemes
      UNION ALL SELECT 'key_feature', unnest(key_features) FROM schemes
    ) legacy LEFT JOIN dictionaries d ON d.code = legacy.code
    LEFT JOIN dictionary_items i ON i.dictionary_id = d.id AND (i.item_label = legacy.value OR i.item_value = legacy.value)
    WHERE i.id IS NULL
  ) THEN RAISE EXCEPTION 'Unmapped scheme labels; inspect distinct scheme labels and add confirmed dictionary items before migration'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT 'product_system' code, product_line value FROM schemes WHERE product_line IS NOT NULL
      UNION ALL SELECT 'style', style FROM schemes WHERE style IS NOT NULL
      UNION ALL SELECT 'budget_tier', budget_tier FROM schemes WHERE budget_tier IS NOT NULL
      UNION ALL SELECT 'industry', unnest(industries) FROM schemes
      UNION ALL SELECT 'functional_zone', unnest(functional_zones) FROM schemes
      UNION ALL SELECT 'key_feature', unnest(key_features) FROM schemes
    ) legacy JOIN dictionaries d ON d.code=legacy.code JOIN dictionary_items i ON i.dictionary_id=d.id
      AND (i.item_label=legacy.value OR i.item_value=legacy.value)
    GROUP BY legacy.code, legacy.value HAVING count(DISTINCT i.id)>1
  ) THEN RAISE EXCEPTION 'Ambiguous scheme label mapping; resolve before migration'; END IF;
END $$;

ALTER TABLE schemes
  ADD COLUMN length_mm integer,
  ADD COLUMN width_mm integer,
  ADD COLUMN height_mm integer,
  ADD COLUMN product_system_id uuid REFERENCES dictionary_items(id) ON DELETE RESTRICT,
  ADD COLUMN style_id uuid REFERENCES dictionary_items(id) ON DELETE RESTRICT,
  ADD COLUMN industry_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN budget_tier_id uuid REFERENCES dictionary_items(id) ON DELETE RESTRICT,
  ADD COLUMN zone_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN feature_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE schemes s SET
  length_mm = (length_cm * 10)::integer,
  width_mm = (width_cm * 10)::integer,
  height_mm = (height_cm * 10)::integer,
  product_system_id = (SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='product_system' AND (i.item_label=s.product_line OR i.item_value=s.product_line)),
  style_id = (SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='style' AND (i.item_label=s.style OR i.item_value=s.style)),
  budget_tier_id = (SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='budget_tier' AND (i.item_label=s.budget_tier OR i.item_value=s.budget_tier)),
  industry_ids = ARRAY(SELECT i.id FROM unnest(s.industries) WITH ORDINALITY v(label, position) JOIN dictionaries d ON d.code='industry' JOIN dictionary_items i ON i.dictionary_id=d.id AND (i.item_label=v.label OR i.item_value=v.label) ORDER BY v.position),
  zone_ids = ARRAY(SELECT i.id FROM unnest(s.functional_zones) WITH ORDINALITY v(label, position) JOIN dictionaries d ON d.code='functional_zone' JOIN dictionary_items i ON i.dictionary_id=d.id AND (i.item_label=v.label OR i.item_value=v.label) ORDER BY v.position),
  feature_ids = ARRAY(SELECT i.id FROM unnest(s.key_features) WITH ORDINALITY v(label, position) JOIN dictionaries d ON d.code='key_feature' JOIN dictionary_items i ON i.dictionary_id=d.id AND (i.item_label=v.label OR i.item_value=v.label) ORDER BY v.position);

ALTER TABLE schemes
  ADD CONSTRAINT schemes_length_mm_positive CHECK (length_mm > 0),
  ADD CONSTRAINT schemes_width_mm_positive CHECK (width_mm > 0),
  ADD CONSTRAINT schemes_height_mm_positive CHECK (height_mm > 0);

CREATE INDEX schemes_product_system_id_idx ON schemes(product_system_id);
CREATE INDEX schemes_style_id_idx ON schemes(style_id);

ALTER TABLE schemes ADD CONSTRAINT schemes_area_matches_dimensions CHECK (
  area_sqm IS NULL OR length_mm IS NULL OR width_mm IS NULL OR
  area_sqm = length_mm::numeric * width_mm::numeric / 1000000
);

CREATE TABLE scheme_selection_migration_backup AS
SELECT id, code, length_cm, width_cm, height_cm, product_line, style, industries,
  budget_tier, functional_zones, key_features FROM schemes;

ALTER TABLE schemes
  DROP COLUMN length_cm, DROP COLUMN width_cm, DROP COLUMN height_cm,
  DROP COLUMN product_line, DROP COLUMN style, DROP COLUMN industries,
  DROP COLUMN budget_tier, DROP COLUMN functional_zones, DROP COLUMN key_features;

ALTER TABLE catalog_options RENAME TO catalog_options_legacy;

CREATE FUNCTION prevent_selection_item_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM schemes WHERE product_system_id=OLD.id OR style_id=OLD.id OR budget_tier_id=OLD.id
      OR OLD.id=ANY(industry_ids) OR OLD.id=ANY(zone_ids) OR OLD.id=ANY(feature_ids)) THEN
    RAISE EXCEPTION 'Dictionary item is referenced by schemes; disable it instead';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER dictionary_item_scheme_reference_guard BEFORE DELETE ON dictionary_items
  FOR EACH ROW EXECUTE FUNCTION prevent_selection_item_delete();
