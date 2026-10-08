-- 移除「阿里云 DashScope 原生接口」（通义万相 2.1 异步任务）协议。它是唯一的异步供应商，
-- 轮询恢复所需的 waiting 状态与 provider_task_id 一并删除；万相 2.7 走「阿里云百炼 Qwen-Image / 万相 2.7」协议。

-- 已提交但未轮询完的尝试再也无法恢复，按结果不明处理（不重复提交，结算时按实际产出计费）。
UPDATE theme_job_provider_attempts SET status = 'unknown', reason = COALESCE(reason, 'PROVIDER_OUTCOME_UNKNOWN'), updated_at = now()
WHERE status = 'waiting';

ALTER TABLE theme_job_provider_attempts DROP CONSTRAINT theme_job_provider_attempts_status_check;
ALTER TABLE theme_job_provider_attempts ADD CONSTRAINT theme_job_provider_attempts_status_check
  CHECK (status IN ('submitting', 'succeeded', 'failed', 'unknown'));
ALTER TABLE theme_job_provider_attempts DROP COLUMN provider_task_id;

-- 该协议的供应商已无法调用：删除其用途分配、模型与供应商（含加密凭据）。
DELETE FROM ai_model_assignments a USING ai_models m, ai_providers p
WHERE a.model_id = m.id AND m.provider_id = p.id AND p.protocol = 'dashscope';
DELETE FROM ai_models m USING ai_providers p WHERE m.provider_id = p.id AND p.protocol = 'dashscope';
DELETE FROM ai_providers WHERE protocol = 'dashscope';
