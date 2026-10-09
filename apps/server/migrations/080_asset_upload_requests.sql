-- 资源首次上传的幂等键：同一上传操作重试（如请求成功但响应丢失）时重放首次结果，不重复新建资源。
-- 用户有意再次上传相同文件时前端使用新的键，仍会新建资源。
CREATE TABLE asset_upload_requests (
  scheme_id uuid NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  asset_id uuid NOT NULL REFERENCES scheme_assets(id) ON DELETE CASCADE,
  created_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scheme_id, idempotency_key)
);
