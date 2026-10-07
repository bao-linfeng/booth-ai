CREATE TABLE sign_in_config (
  id         boolean PRIMARY KEY DEFAULT TRUE,
  enabled    boolean NOT NULL DEFAULT TRUE,
  daily_amount integer NOT NULL DEFAULT 10 CHECK (daily_amount >= 1 AND daily_amount <= 10000),
  timezone   text NOT NULL DEFAULT 'Asia/Shanghai',
  CONSTRAINT sign_in_config_singleton CHECK (id = TRUE)
);

-- 插入默认行（保持现有行为：启用，10分/天，Asia/Shanghai 时区）
INSERT INTO sign_in_config (id, enabled, daily_amount, timezone)
VALUES (TRUE, TRUE, 10, 'Asia/Shanghai');
