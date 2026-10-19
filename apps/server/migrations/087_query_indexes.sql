-- 按合成数据量（方案 5000、资产版本 42 万、检索 100 万、项目 10 万）执行 EXPLAIN ANALYZE 后补充的索引

-- 方案当前修订最新一次整体审核（候选池、展位尺寸目录、就绪检查），INCLUDE decision 可走 Index Only Scan
CREATE INDEX scheme_reviews_latest_idx ON scheme_reviews (scheme_id, scheme_revision, phase, created_at DESC, id DESC) INCLUDE (decision);
DROP INDEX scheme_reviews_scheme_id_idx;
-- 与 request_key 唯一约束自带的索引重复
DROP INDEX scheme_reviews_request_key_idx;

-- 资产最新版本统一按 created_at DESC, id DESC 取第一条，原索引缺 id 需额外排序
CREATE INDEX asset_versions_latest_idx ON asset_versions (asset_id, created_at DESC, id DESC);
DROP INDEX asset_versions_asset_id_idx;

-- 管理端项目列表默认排序（无筛选条件时）
CREATE INDEX projects_updated_idx ON projects (updated_at DESC, id DESC);

-- 管理端检索记录按方案编号筛选，查询须写成 jsonb_path_query_array(result_snapshot, '$[*].code') @> ...
CREATE INDEX selection_searches_scheme_codes_idx ON selection_searches
  USING gin (jsonb_path_query_array(result_snapshot, '$[*].code') jsonb_path_ops);
