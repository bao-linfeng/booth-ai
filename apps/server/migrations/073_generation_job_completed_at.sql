-- 任务首次进入终态的时间。管理端耗时按 completed_at - created_at 计算，
-- 不受之后选定效果、交付状态等对 updated_at 的更新影响。
ALTER TABLE theme_jobs ADD COLUMN completed_at timestamptz;
ALTER TABLE artwork_jobs ADD COLUMN completed_at timestamptz;

-- 历史任务：主题取最后一张结果图或最后一次供应商尝试的时间，素材取最后一个方向的更新时间；都没有时退回 updated_at。
UPDATE theme_jobs j SET completed_at = LEAST(j.updated_at, COALESCE(GREATEST(
  (SELECT max(r.created_at) FROM theme_job_results r WHERE r.job_id = j.id),
  (SELECT max(a.updated_at) FROM theme_job_provider_attempts a WHERE a.job_id = j.id)), j.updated_at))
WHERE j.status::text IN ('succeeded', 'partially_succeeded', 'failed');

UPDATE artwork_jobs j SET completed_at = LEAST(j.updated_at, COALESCE(
  (SELECT max(d.updated_at) FROM artwork_job_directions d WHERE d.job_id = j.id), j.updated_at))
WHERE j.status::text IN ('succeeded', 'partially_succeeded', 'failed');

-- 终态只写一次；任务若被重新打开则清空，等再次结束时重新记录。
CREATE FUNCTION stamp_generation_job_completed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text IN ('succeeded', 'partially_succeeded', 'failed') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER theme_jobs_stamp_completed BEFORE INSERT OR UPDATE OF status ON theme_jobs
  FOR EACH ROW EXECUTE FUNCTION stamp_generation_job_completed();
CREATE TRIGGER artwork_jobs_stamp_completed BEFORE INSERT OR UPDATE OF status ON artwork_jobs
  FOR EACH ROW EXECUTE FUNCTION stamp_generation_job_completed();
