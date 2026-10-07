DROP TABLE applicability_questions;

ALTER TABLE schemes DROP COLUMN applicable_conditions;

UPDATE admin_roles
SET permission_codes = ARRAY(
      SELECT code FROM unnest(permission_codes) AS existing(code)
      WHERE code NOT LIKE 'questions.%'
      ORDER BY code
    ),
    revision = revision + 1,
    updated_at = now()
WHERE EXISTS (SELECT 1 FROM unnest(permission_codes) AS existing(code) WHERE code LIKE 'questions.%');

-- 需求解析模板（含按默认正文保存的副本）去掉适用条件字段说明与示例；管理员改写过的片段不匹配则保持不变
UPDATE prompt_templates t
SET body = cleaned.body, revision = t.revision + 1, updated_at = now()
FROM (
  SELECT id, replace(replace(replace(body,
      '- applicabilityAnswers：左侧补充适用条件，对应 dictionaries.applicabilityQuestions，以问题 id 为键、boolean 为值。结合 label 和 helpText 理解问题，只输出用户明确回答的事实；false 也是有效答案，未提及或不清楚不等于 false。' || chr(10), ''),
      '多选为 string[]，applicabilityAnswers 为 Record<string, boolean>。', '多选为 string[]。'),
      chr(10) || '假设 applicabilityQuestions 有 {"id":"allow-hanging","label":"场馆是否允许吊挂？","helpText":"需由场馆确认"}：'
        || chr(10) || '输入：场馆明确不允许吊挂。'
        || chr(10) || '输出：{"fields":{"applicabilityAnswers":{"value":{"allow-hanging":false},"evidence":"场馆明确不允许吊挂"}},"unhandledText":[]}', '') AS body
  FROM prompt_templates
  WHERE purpose = 'filter'
) cleaned
WHERE t.id = cleaned.id AND t.body <> cleaned.body;
