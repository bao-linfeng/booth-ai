-- 项目列表与工作台按"最新一条跟进记录"取下次跟进时间（kind='follow-up'），原 project_events_project_idx 不含 kind
CREATE INDEX project_events_kind_idx ON project_events (project_id, kind, created_at DESC, id DESC);
