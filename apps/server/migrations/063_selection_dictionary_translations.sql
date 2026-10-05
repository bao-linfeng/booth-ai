WITH translations(code, value, english, japanese) AS (VALUES
  ('product_system','fs62_fabric','FS62 fabric frame','FS62ファブリックフレーム'),
  ('product_system','aluminum_frame','Aluminum frame','アルミフレーム'),
  ('product_system','truss','Truss','トラス'),
  ('product_system','lightbox_wall','Lightbox wall','ライトボックスウォール'),
  ('product_system','art_square_wall','Art Square wall','Art Squareウォール'),
  ('product_system','hybrid','Hybrid system','混合システム'),
  ('style','modern','Modern minimalist','モダン・ミニマル'),
  ('style','natural','Natural and sustainable','ナチュラル・エコ'),
  ('style','technology','Futuristic technology','近未来・テクノロジー'),
  ('style','new_chinese','Contemporary Chinese','新中式'),
  ('style','light_luxury','Understated luxury','控えめなラグジュアリー'),
  ('style','industrial','Industrial','インダストリアル'),
  ('style','warm','Warm and cozy','暖かく居心地のよい'),
  ('style','monochrome','Minimal black and white','ミニマル・モノクロ'),
  ('style','business_cool','Cool-toned business','寒色系ビジネス'),
  ('style','gallery_white','White gallery','ホワイトギャラリー'),
  ('style','trendy','Trendy and vibrant','トレンディ・活気'),
  ('industry','electronics','Consumer electronics','家電・電子機器'),
  ('industry','building_home','Building materials and home furnishings','建材・家具'),
  ('industry','jewelry','Jewelry and watches','ジュエリー・時計'),
  ('industry','auto','Automotive','自動車'),
  ('industry','food','Food and beverages','食品・飲料'),
  ('industry','medical','Healthcare and pharmaceuticals','医療・ヘルスケア'),
  ('industry','fashion','Apparel and textiles','アパレル・繊維'),
  ('industry','arts','Culture and arts','文化・芸術'),
  ('industry','general','General purpose','汎用'),
  ('industry','hardware','Hardware and electrical appliances','金物・電気製品'),
  ('industry','baby','Baby and children products','ベビー・キッズ用品'),
  ('industry','beauty','Skincare and cosmetics','スキンケア・化粧品'),
  ('budget_tier','low','Low (under CNY 30,000)','低価格（3万元未満）'),
  ('budget_tier','medium','Medium (CNY 30,000–80,000)','中価格（3万〜8万元）'),
  ('budget_tier','high','High (over CNY 80,000)','高価格（8万元超）'),
  ('functional_zone','reception','Reception area','受付エリア'),
  ('functional_zone','display','Display area','展示エリア'),
  ('functional_zone','negotiation','Meeting area','商談スペース'),
  ('functional_zone','storage','Storage room','収納室'),
  ('functional_zone','brand_wall','Brand wall','ブランドウォール'),
  ('functional_zone','product_display','Product display area','製品展示エリア'),
  ('key_feature','storage','Storage room','収納室'),
  ('key_feature','symmetry','Symmetry','対称'),
  ('key_feature','shelf','Shelving','棚'),
  ('key_feature','display_platform','Display platform','展示台'),
  ('key_feature','display_case','Display cabinet','展示キャビネット'),
  ('key_feature','arc','Arc','アーチ'),
  ('key_feature','arc_element','Curved elements','曲線要素'),
  ('key_feature','light_strip','LED strip','LEDストリップ'),
  ('key_feature','lightbox','Lightbox','ライトボックス'),
  ('key_feature','television','Television','テレビ')
)
UPDATE dictionary_items i SET labels = jsonb_build_object('en', t.english, 'ja', t.japanese) || i.labels
FROM translations t JOIN dictionaries d ON d.code = t.code
WHERE i.dictionary_id = d.id AND i.item_value = t.value;

WITH aliases(code, value, locale, text) AS (VALUES
  ('style','modern','en','modern minimalism'), ('style','modern','en','minimalist'),
  ('style','modern','ja','モダン'), ('style','modern','ja','ミニマル'),
  ('style','modern','zh-CN','简洁现代'),
  ('functional_zone','negotiation','en','discussion area'),
  ('functional_zone','negotiation','en','meeting space'),
  ('functional_zone','negotiation','ja','商談エリア'),
  ('functional_zone','storage','en','storeroom'),
  ('functional_zone','storage','ja','倉庫'),
  ('product_system','fs62_fabric','en','FS62'),
  ('product_system','fs62_fabric','ja','FS62布フレーム')
), grouped AS (
  SELECT code, value, jsonb_agg(jsonb_build_object('locale', locale, 'text', text)) AS names
  FROM aliases GROUP BY code, value
)
UPDATE dictionary_items i SET aliases = i.aliases || a.names
FROM grouped a JOIN dictionaries d ON d.code = a.code
WHERE i.dictionary_id = d.id AND i.item_value = a.value;

UPDATE dictionary_items i SET labels = jsonb_build_object(
  'en', i.item_value || CASE WHEN i.item_value = '1' THEN ' open side' ELSE ' open sides' END,
  'ja', i.item_value || '面開放') || i.labels
FROM dictionaries d WHERE d.id = i.dictionary_id AND d.code = 'opening_count';
