-- 四向图单任务内同时生成的方向数（1 即逐个方向串行）。只影响执行速度与供应商并发、不影响出图，
-- 因此不冻结进 generation_snapshot：worker 在任务开始生成时读取当前值，修改后对尚未开始执行的任务生效。
ALTER TABLE artwork_generation_settings
  ADD COLUMN direction_concurrency smallint NOT NULL DEFAULT 4 CHECK (direction_concurrency BETWEEN 1 AND 4);
