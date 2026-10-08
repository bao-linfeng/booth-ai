-- 在线客服（docs/一期功能拆分/在线客服模块详细设计.md §9、开发计划 §5）：
-- 访客、会话、上下文、消息、译文、设置、邮件 outbox；AI 用途 cs_translation；权限 customer-service.*（仅授予 ROLE_ADMIN）。

CREATE DOMAIN cs_locale AS text
  CHECK (VALUE IN ('zh','en','fr','de','ja','ru','it','es','ar','hi','pt','ms'));

-- 访客：库中只存令牌的 SHA-256
CREATE TABLE cs_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  locale cs_locale NOT NULL,
  merged_user_id uuid REFERENCES users(id),
  merged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((merged_user_id IS NULL) = (merged_at IS NULL))
);
CREATE INDEX cs_visitors_last_seen_idx ON cs_visitors(last_seen_at) WHERE deleted_at IS NULL;

-- 匿名提交的项目绑定访客（设计 §4.2），不参与项目归属
ALTER TABLE projects ADD COLUMN visitor_id uuid REFERENCES cs_visitors(id);
CREATE INDEX projects_visitor_idx ON projects(visitor_id) WHERE visitor_id IS NOT NULL;

CREATE SEQUENCE cs_conversation_number_seq;
CREATE TABLE cs_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_no text NOT NULL UNIQUE DEFAULT ('CS-' || lpad(nextval('cs_conversation_number_seq')::text, 8, '0')),
  customer_user_id uuid REFERENCES users(id),
  visitor_id uuid REFERENCES cs_visitors(id),
  origin_visitor_id uuid REFERENCES cs_visitors(id),      -- 合并前的访客，仅供追溯
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','active','closed')),
  agent_admin_id uuid REFERENCES admins(id),               -- active 时为当前坐席；closed 时保留最后坐席
  customer_locale cs_locale NOT NULL,
  contact_email text CHECK (contact_email IS NULL OR (contact_email = lower(contact_email) AND contact_email <> '')),
  has_offline_message boolean NOT NULL DEFAULT false,
  last_message_seq bigint,                                 -- 含 internal
  last_public_seq bigint,                                  -- 仅 public，用于客户未读
  last_message_at timestamptz,
  customer_read_seq bigint NOT NULL DEFAULT 0,
  agent_read_seq bigint NOT NULL DEFAULT 0,
  awaiting_since timestamptz,                              -- queued 且客户已发言（计划 G9）
  queued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  closed_at timestamptz,
  close_reason text CHECK (close_reason IN ('agent','merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (num_nonnulls(customer_user_id, visitor_id) = 1),
  CHECK (status <> 'active' OR agent_admin_id IS NOT NULL),
  CHECK (status <> 'queued' OR agent_admin_id IS NULL),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK (status = 'queued' OR awaiting_since IS NULL)
);
CREATE UNIQUE INDEX cs_conversations_user_open_idx ON cs_conversations(customer_user_id)
  WHERE status <> 'closed' AND deleted_at IS NULL AND customer_user_id IS NOT NULL;
CREATE UNIQUE INDEX cs_conversations_visitor_open_idx ON cs_conversations(visitor_id)
  WHERE status <> 'closed' AND deleted_at IS NULL AND visitor_id IS NOT NULL;
CREATE INDEX cs_conversations_queue_idx ON cs_conversations(awaiting_since)
  WHERE status = 'queued' AND deleted_at IS NULL;
CREATE INDEX cs_conversations_agent_idx ON cs_conversations(agent_admin_id, status) WHERE deleted_at IS NULL;
CREATE INDEX cs_conversations_user_idx ON cs_conversations(customer_user_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX cs_conversations_visitor_idx ON cs_conversations(visitor_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX cs_conversations_closed_idx ON cs_conversations(last_message_at) WHERE status = 'closed' AND deleted_at IS NULL;

CREATE TABLE cs_conversation_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES cs_conversations(id),
  kind text NOT NULL CHECK (kind IN ('scheme','project')),
  ref text NOT NULL,                                       -- schemeCode 或 projectId
  project_id uuid REFERENCES projects(id),
  entry_point text NOT NULL CHECK (entry_point IN ('scheme_detail','quote_receipt','my_project','floating')),
  customer_locale cs_locale NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, kind, ref),
  CHECK ((kind = 'project') = (project_id IS NOT NULL))
);
CREATE INDEX cs_conversation_contexts_project_idx ON cs_conversation_contexts(project_id) WHERE project_id IS NOT NULL;

CREATE TABLE cs_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL UNIQUE,
  conversation_id uuid NOT NULL REFERENCES cs_conversations(id),
  sender_type text NOT NULL CHECK (sender_type IN ('customer','agent','system')),
  sender_admin_id uuid REFERENCES admins(id),
  kind text NOT NULL CHECK (kind IN ('text','offline','note','context','event')),
  visibility text NOT NULL CHECK (visibility IN ('public','internal')),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  locale cs_locale NOT NULL,
  context_id uuid REFERENCES cs_conversation_contexts(id),
  event_code text CHECK (event_code IN ('claimed','released','transferred','closed','merged','agent_unavailable')),
  event_params jsonb,
  client_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (conversation_id, sender_type, client_message_id),
  CHECK ((sender_type = 'agent') = (sender_admin_id IS NOT NULL)),
  CHECK (kind NOT IN ('text','offline','note') OR char_length(btrim(body)) >= 1),
  CHECK (kind <> 'note' OR (visibility = 'internal' AND sender_type = 'agent')),
  CHECK (kind <> 'offline' OR sender_type = 'customer'),
  CHECK ((kind = 'context') = (context_id IS NOT NULL)),
  CHECK ((kind = 'event') = (event_code IS NOT NULL))
);
CREATE INDEX cs_messages_conversation_seq_idx ON cs_messages(conversation_id, seq) WHERE deleted_at IS NULL;
CREATE INDEX cs_messages_created_idx ON cs_messages(created_at) WHERE deleted_at IS NULL;

-- pending 行即翻译 outbox（计划 G1）
CREATE TABLE cs_message_translations (
  message_id uuid NOT NULL REFERENCES cs_messages(id),
  target_locale cs_locale NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  body text,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, target_locale),
  CHECK (status <> 'done' OR body IS NOT NULL)
);
CREATE INDEX cs_message_translations_pending_idx ON cs_message_translations(dispatched_at NULLS FIRST) WHERE status = 'pending';

-- 单行设置，revision 做乐观锁
CREATE TABLE cs_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  translation_enabled boolean NOT NULL DEFAULT true,
  agent_locale cs_locale NOT NULL DEFAULT 'zh',
  offline_notify_emails text[] NOT NULL DEFAULT '{}' CHECK (cardinality(offline_notify_emails) <= 20),
  reply_email_enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES admins(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cs_settings DEFAULT VALUES;

CREATE TABLE cs_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES cs_conversations(id),
  kind text NOT NULL CHECK (kind IN ('offline_notice','reply_notice')),
  recipient text NOT NULL CHECK (recipient = lower(recipient) AND recipient <> ''),
  locale cs_locale NOT NULL,
  after_seq bigint NOT NULL,          -- 邮件覆盖 seq > after_seq 的消息
  covered_seq bigint,                 -- 发送时实际覆盖到的最大 seq；下一封从这里继续
  due_at timestamptz NOT NULL,        -- 到期时间，失败退避时顺延
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 每个（会话，类型，收件人）至多一封待发邮件，后续消息合并进去
CREATE UNIQUE INDEX cs_email_outbox_pending_key ON cs_email_outbox(conversation_id, kind, recipient)
  WHERE sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL;
CREATE INDEX cs_email_outbox_due_idx ON cs_email_outbox(due_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL;

-- AI 用途：cs_translation 为文本用途，不计积分
ALTER TABLE ai_model_assignments DROP CONSTRAINT ai_model_assignments_purpose_check;
ALTER TABLE ai_model_assignments ADD CONSTRAINT ai_model_assignments_purpose_check
  CHECK (purpose IN ('selection_parse','theme','artwork','cs_translation'));
ALTER TABLE ai_model_assignments DROP CONSTRAINT ai_model_assignments_check;
ALTER TABLE ai_model_assignments ADD CONSTRAINT ai_model_assignments_check
  CHECK ((purpose IN ('selection_parse','cs_translation')) = (unit_credits IS NULL));

-- 权限：只授予 ROLE_ADMIN（设计 §7.1.2）；已全部拥有时 revision 不变，可重复执行
UPDATE admin_roles SET permission_codes = ARRAY(
  SELECT DISTINCT code FROM unnest(permission_codes || ARRAY[
    'customer-service.read','customer-service.reply','customer-service.supervise','customer-service.settings']) AS p(code)
  ORDER BY code), revision = revision + 1, updated_at = now()
WHERE name = 'ROLE_ADMIN' AND NOT (permission_codes @> ARRAY[
  'customer-service.read','customer-service.reply','customer-service.supervise','customer-service.settings']);
