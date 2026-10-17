-- 智选解析每次模型调用的结果（模型、耗时、成功或失败阶段），用于定位降级原因。
-- 未配置模型时为 NULL；不保存模型原始输出与凭据。
ALTER TABLE selection_parses ADD COLUMN llm_attempts jsonb;
