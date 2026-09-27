-- 先给存量空值填默认值，再加 NOT NULL 约束
UPDATE dictionaries SET type = 'default' WHERE type IS NULL;

ALTER TABLE dictionaries
  ALTER COLUMN type SET NOT NULL;
