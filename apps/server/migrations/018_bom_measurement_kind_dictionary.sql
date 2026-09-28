INSERT INTO dictionaries (code, name, type)
VALUES ('measurementKind', '计量类型', 'bom')
ON CONFLICT (code) DO NOTHING;

INSERT INTO dictionary_items (dictionary_id, item_value, item_label, sort_order)
SELECT d.id, v.item_value, v.item_label, v.sort_order
FROM dictionaries d
CROSS JOIN (VALUES
  ('count', '个数', 1),
  ('length', '长度', 2),
  ('area', '面积', 3)
) AS v(item_value, item_label, sort_order)
WHERE d.code = 'measurementKind'
ON CONFLICT (dictionary_id, item_value) DO NOTHING;
