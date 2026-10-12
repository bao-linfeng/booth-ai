# 服务端数据库 ER 图

## 口径

以下图表根据 `apps/server/migrations/001_*.sql` 至 `080_*.sql` 的最终结构整理。图中覆盖业务主表及主要外键；逐表职责、关键字段和业务约束见[全量表设计目录](全量表设计目录.md)。运行维护与归档表在本文末尾单独成图/列出。

- `||--o{`、`o|--o{` 等关系标记表示数据库外键，基数按当前字段可空性与唯一约束表达。
- `..>` 虚线表示业务逻辑关联：可能由业务号、字段值、JSON 快照或代码校验实现，不是外键约束。
- 图中标注 `view` 的对象是数据库视图，不是基础表。
- 迁移中已删除的表不画入当前模型，例如 `manual_requests`、`ai_model_configs` 和 `applicability_questions`。
- `project_operations` 是幂等操作回执表，`foundation_*` 是基础任务示例表；它们不代表项目领域或生成领域的全部运行时机制。

## 身份与智选

```mermaid
erDiagram
  USERS {
    uuid id PK
    bigint external_user_id UK
    text username UK
    boolean enabled
  }
  ADMINS {
    uuid id PK
    bigint external_user_id UK
    text username UK
    boolean enabled
  }
  ADMIN_ROLES {
    bigint id PK
    text name UK
    text_array permission_codes
    integer revision
  }
  SELECTION_ATTEMPTS {
    uuid id PK
    text visitor_id
    uuid user_id FK
    timestamptz created_at
  }
  SELECTION_PARSES {
    uuid id PK
    uuid attempt_id FK
    uuid user_id FK
    jsonb final_requirement
  }
  SELECTION_SEARCHES {
    uuid id PK
    uuid attempt_id FK
    uuid parse_id FK
    uuid user_id FK
    text status
    jsonb result_snapshot
  }
  ADMIN_AUDIT_LOGS {
    uuid id PK
    uuid admin_id FK
    text action
    text target_type
    text target_id
  }
  USERS o|--o{ SELECTION_ATTEMPTS : "user_id"
  USERS o|--o{ SELECTION_PARSES : "user_id"
  USERS o|--o{ SELECTION_SEARCHES : "user_id"
  SELECTION_ATTEMPTS ||--o{ SELECTION_PARSES : "attempt_id"
  SELECTION_ATTEMPTS ||--o{ SELECTION_SEARCHES : "attempt_id"
  SELECTION_PARSES o|--o{ SELECTION_SEARCHES : "parse_id"
  ADMINS ||--o{ ADMIN_AUDIT_LOGS : "admin_id"
```

`selection_attempts.visitor_id` 是访客标识文本，不引用客服访客表。管理员角色通过外部角色 ID/同步数据与本地 `admin_roles` 协作，`admins` 表不以外键关联角色表。

## 方案、资产与资料

```mermaid
erDiagram
  ADMINS {
    uuid id PK
  }
  USERS {
    uuid id PK
  }
  SCHEMES {
    uuid id PK
    text code UK
    text parent_code FK
    text publish_status
    text verification_status
    integer revision
  }
  SCHEME_ASSETS {
    uuid id PK
    uuid scheme_id FK
    uuid related_asset_id FK
    uuid owner_user_id FK
    text type
    text source
    text visibility
  }
  ASSET_VERSIONS {
    uuid id PK
    uuid asset_id FK
    text object_key UK
    text checksum
  }
  SCHEME_BOMS {
    uuid id PK
    uuid scheme_id FK
    uuid source_asset_id FK
    uuid model_asset_id FK
    integer revision
    text status
  }
  SCHEME_BOM_ITEMS {
    uuid id PK
    uuid bom_id FK
    integer ordinal
    text measurement_kind
  }
  BOM_CHANGE_LOGS {
    uuid id PK
    uuid bom_id FK
    uuid admin_id FK
    integer before_revision
    integer after_revision
  }
  BOM_IMPORTS {
    uuid id PK
    uuid scheme_id FK
    text status
  }
  BOM_VERIFICATIONS {
    uuid id PK
    uuid bom_id FK
    uuid model_asset_version_id FK
    uuid admin_id FK
    text decision
  }
  SCHEME_REVIEWS {
    uuid id PK
    uuid scheme_id FK
    uuid admin_id FK
  }
  SCHEME_IMPORTS {
    uuid id PK
    uuid created_by FK
    text status
    jsonb preview
  }
  DICTIONARIES {
    uuid id PK
    text code UK
    text type
  }
  DICTIONARY_ITEMS {
    uuid id PK
    uuid dictionary_id FK
    text item_value
    jsonb labels
    jsonb aliases
  }
  CATALOG_OPTIONS_LEGACY {
    uuid id PK
    text type
    text key
  }
  ASSET_UPLOAD_REQUESTS {
    uuid scheme_id PK
    uuid idempotency_key PK
    uuid asset_id FK
    uuid created_by FK
  }
  SCHEMES ||--o{ SCHEME_ASSETS : "scheme_id"
  SCHEMES ||--o| SCHEME_BOMS : "scheme_id"
  SCHEMES ||--o{ BOM_IMPORTS : "scheme_id"
  SCHEMES ||--o{ SCHEME_REVIEWS : "scheme_id"
  ADMINS o|--o{ SCHEME_REVIEWS : "admin_id"
  ADMINS o|--o{ SCHEME_IMPORTS : "created_by"
  DICTIONARIES ||--o{ DICTIONARY_ITEMS : "dictionary_id"
  DICTIONARY_ITEMS o|..o{ SCHEMES : "selection item ID arrays / scalar IDs"
  SCHEMES ||--o{ ASSET_UPLOAD_REQUESTS : "scheme_id"
  SCHEMES o|--o{ SCHEMES : "parent_code -> code"
  SCHEME_ASSETS o|--o{ SCHEME_ASSETS : "related_asset_id"
  USERS o|--o{ SCHEME_ASSETS : "owner_user_id"
  SCHEME_ASSETS ||--o{ ASSET_VERSIONS : "asset_id"
  SCHEME_BOMS ||--o{ SCHEME_BOM_ITEMS : "bom_id"
  SCHEME_BOMS ||--o{ BOM_VERIFICATIONS : "bom_id"
  SCHEME_BOMS ||--o{ BOM_CHANGE_LOGS : "bom_id"
  ADMINS ||--o{ BOM_CHANGE_LOGS : "admin_id"
  ASSET_VERSIONS o|--o{ BOM_VERIFICATIONS : "model_asset_version_id"
  SCHEME_ASSETS o|--o{ ASSET_UPLOAD_REQUESTS : "asset_id"
```

`scheme_boms.scheme_id` 唯一，因此每个方案至多一条当前清单主记录。方案的行业/功能分区/特征多选项以 UUID 数组存放，没有逐项外键；单选字典字段则有外键。迁移备份表和 opening direction 归档表列在本文末尾。`scheme_baseline_assets` 是按公共方案来源过滤的 `scheme_assets` 视图。

## 生成与积分

```mermaid
erDiagram
  USERS {
    uuid id PK
  }
  SCHEMES {
    uuid id PK
    text code UK
  }
  SCHEME_ASSETS {
    uuid id PK
    uuid owner_user_id FK
    text source
    text visibility
  }
  ASSET_VERSIONS {
    uuid id PK
    uuid asset_id FK
  }
  THEME_JOBS {
    uuid id PK
    uuid user_id FK
    uuid search_id FK
    text scheme_code
    uuid selected_result_id
    integer selection_revision
    text status
  }
  THEME_JOB_RESULTS {
    uuid id PK
    uuid job_id FK
    uuid asset_version_id FK
    text asset_id
  }
  THEME_JOB_OUTBOX {
    uuid id PK
    uuid job_id FK
  }
  THEME_JOB_PROVIDER_ATTEMPTS {
    uuid id PK
    uuid job_id FK
    uuid model_id
    text status
  }
  THEME_JOB_GENERATED_URLS {
    uuid id PK
    uuid job_id FK
  }
  ARTWORK_JOBS {
    uuid id PK
    uuid user_id FK
    uuid theme_job_id
    uuid theme_result_id
    text delivery_status
  }
  ARTWORK_JOB_RESULTS {
    uuid id PK
    uuid job_id FK
    uuid asset_version_id FK
    text direction
  }
  ARTWORK_JOB_DIRECTIONS {
    uuid job_id FK
    text direction PK
    text status
  }
  ARTWORK_JOB_OUTBOX {
    uuid id PK
    uuid job_id FK
  }
  CREDIT_TRANSACTIONS {
    uuid id PK
    uuid user_id FK
    uuid theme_job_id FK
    uuid artwork_job_id FK
    integer amount
  }
  CREDIT_RESERVATIONS {
    uuid id PK
    uuid user_id FK
    uuid theme_job_id FK
    uuid artwork_job_id FK
    integer reserved_amount
    text status
  }
  SIGN_IN_RECORDS {
    uuid id PK
    uuid user_id FK
    date sign_date
  }
  SELECTION_SEARCHES {
    uuid id PK
    uuid user_id FK
    text status
  }
  USERS ||--o{ THEME_JOBS : "user_id"
  USERS ||--o{ ARTWORK_JOBS : "user_id"
  USERS ||--o{ CREDIT_TRANSACTIONS : "user_id"
  USERS ||--o{ CREDIT_RESERVATIONS : "user_id"
  USERS ||--o{ SIGN_IN_RECORDS : "user_id"
  SELECTION_SEARCHES o|--o{ THEME_JOBS : "search_id"
  THEME_JOBS ||--o{ THEME_JOB_RESULTS : "job_id"
  THEME_JOBS ||--o| THEME_JOB_OUTBOX : "job_id"
  THEME_JOBS ||--o{ THEME_JOB_PROVIDER_ATTEMPTS : "job_id"
  THEME_JOBS ||--o{ THEME_JOB_GENERATED_URLS : "job_id"
  THEME_JOBS o|--o| CREDIT_RESERVATIONS : "theme_job_id"
  THEME_JOBS o|--o| CREDIT_TRANSACTIONS : "theme_job_id"
  ARTWORK_JOBS ||--o{ ARTWORK_JOB_RESULTS : "job_id"
  ARTWORK_JOBS ||--o{ ARTWORK_JOB_DIRECTIONS : "job_id"
  ARTWORK_JOBS ||--o| ARTWORK_JOB_OUTBOX : "job_id"
  ARTWORK_JOBS o|--o| CREDIT_RESERVATIONS : "artwork_job_id"
  ARTWORK_JOBS o|--o| CREDIT_TRANSACTIONS : "artwork_job_id"
  THEME_JOBS o|..o{ ARTWORK_JOBS : "theme_job_id (FK)"
  THEME_JOB_RESULTS o|..o{ ARTWORK_JOBS : "theme_result_id (FK)"
  ASSET_VERSIONS o|--o{ ARTWORK_JOB_RESULTS : "asset_version_id"
  ASSET_VERSIONS o|--o{ THEME_JOB_RESULTS : "asset_version_id"
  SCHEMES o|..o{ THEME_JOBS : "scheme_code (business key)"
  SCHEME_ASSETS o|..o{ THEME_JOB_RESULTS : "asset_id (text identifier)"
```

主题任务的 `selected_result_id` 与 `theme_job_results.id` 之间由生成模块校验，不是数据库外键。主题结果 `asset_id` 为文本标识；生成资产与 `scheme_assets` 的关联、方案编码与 `schemes` 的关联也不是外键。`user_credit_balances` 是对 `credit_transactions` 聚合得到的视图。

## 项目与报价

```mermaid
erDiagram
  USERS {
    uuid id PK
  }
  ADMINS {
    uuid id PK
  }
  CS_VISITORS {
    uuid id PK
  }
  PROJECTS {
    uuid id PK
    text project_no UK
    text request_no UK
    text source_type
    uuid customer_user_id FK
    uuid visitor_id FK
    uuid assignee_admin_id FK
    text status
    integer revision
    jsonb request_snapshot
    jsonb scheme_snapshot
    jsonb materials_snapshot
  }
  PROJECT_ASSET_VERSIONS {
    uuid project_id FK
    uuid asset_version_id FK
  }
  ASSET_VERSIONS {
    uuid id PK
  }
  PROJECT_EVENTS {
    uuid id PK
    uuid project_id FK
    uuid actor_admin_id FK
    text kind
  }
  PROJECT_NOTIFICATION_OUTBOX {
    uuid id PK
    uuid project_id FK
    uuid event_id FK
  }
  PROJECT_NOTIFICATION_READS {
    uuid notification_id FK
    uuid admin_id FK
  }
  PROJECT_QUOTATION_REVISIONS {
    uuid project_id FK
    integer revision PK
    uuid created_by FK
    jsonb snapshot
  }
  PROJECT_ASSIGNMENT_CONFIG {
    boolean id PK
    uuid default_assignee_admin_id FK
    uuid updated_by FK
  }
  PROJECT_RECEIPT_EMAILS {
    uuid id PK
    uuid project_id FK
    text status
  }
  PROJECT_OPERATIONS {
    text actor_type PK
    uuid actor_id PK
    text operation PK
    text target PK
    text request_key PK
  }
  USERS o|--o{ PROJECTS : "customer_user_id"
  CS_VISITORS o|--o{ PROJECTS : "visitor_id"
  ADMINS ||--o{ PROJECTS : "assignee_admin_id"
  PROJECTS ||--o{ PROJECT_EVENTS : "project_id"
  PROJECTS ||--o{ PROJECT_NOTIFICATION_OUTBOX : "project_id"
  PROJECTS ||--o{ PROJECT_QUOTATION_REVISIONS : "project_id"
  PROJECTS ||--o| PROJECT_RECEIPT_EMAILS : "project_id"
  PROJECTS ||--o{ PROJECT_ASSET_VERSIONS : "project_id"
  ASSET_VERSIONS ||--o{ PROJECT_ASSET_VERSIONS : "asset_version_id"
  ADMINS o|--o{ PROJECT_EVENTS : "actor_admin_id"
  PROJECT_EVENTS ||--o| PROJECT_NOTIFICATION_OUTBOX : "event_id"
  PROJECT_NOTIFICATION_OUTBOX ||--o{ PROJECT_NOTIFICATION_READS : "notification_id"
  ADMINS ||--o{ PROJECT_NOTIFICATION_READS : "admin_id"
  ADMINS ||--o{ PROJECT_QUOTATION_REVISIONS : "created_by"
  ADMINS o|--o{ PROJECT_ASSIGNMENT_CONFIG : "default_assignee_admin_id / updated_by"
```

询价和人工需求的具体内容存放在 `projects.request_snapshot`，来源通过 `source_type` 区分；当前 schema 没有活动 `quote_requests` 或 `manual_requests` 表。方案、主题结果、清单与其他修订信息以快照 JSON 保存，不以外键连接源记录。`project_operations.actor_id` 是多态主体标识，因此不连到 users/admins 外键。

## AI 配置、提示词与客服

```mermaid
erDiagram
  USERS {
    uuid id PK
  }
  ADMINS {
    uuid id PK
  }
  DICTIONARY_ITEMS {
    uuid id PK
  }
  ADMINS {
    uuid id PK
  }
  AI_PROVIDERS {
    uuid id PK
    text protocol
    text base_url
  }
  AI_MODELS {
    uuid id PK
    uuid provider_id FK
    text model
    text kind
  }
  AI_MODEL_ASSIGNMENTS {
    text purpose PK
    uuid model_id PK, FK
    integer position
  }
  PROMPT_TEMPLATES {
    uuid id PK
    text purpose
    uuid industry_id FK
    uuid style_id FK
    boolean enabled
  }
  PROMPT_TEMPLATES {
    uuid id PK
    uuid industry_id FK
    uuid style_id FK
    uuid created_by FK
  }
  CS_VISITORS {
    uuid id PK
    uuid merged_user_id FK
    text token_hash UK
  }
  CS_CONVERSATIONS {
    uuid id PK
    uuid customer_user_id FK
    uuid visitor_id FK
    uuid origin_visitor_id FK
    uuid agent_admin_id FK
    text status
  }
  CS_CONVERSATION_CONTEXTS {
    uuid id PK
    uuid conversation_id FK
    uuid project_id FK
    text kind
    text ref
  }
  PROJECTS {
    uuid id PK
  }
  CS_MESSAGES {
    uuid id PK
    uuid conversation_id FK
    uuid sender_admin_id FK
    uuid context_id FK
    text visibility
  }
  CS_MESSAGE_TRANSLATIONS {
    uuid message_id PK
    uuid model_id FK
    text target_locale PK
  }
  CS_SETTINGS {
    boolean id PK
    uuid updated_by FK
  }
  CS_EMAIL_OUTBOX {
    uuid id PK
    uuid conversation_id FK
    text kind
    text recipient
  }
  AI_PROVIDERS ||--o{ AI_MODELS : "provider_id"
  AI_MODELS ||--o{ AI_MODEL_ASSIGNMENTS : "model_id"
  AI_MODELS o|--o{ CS_MESSAGE_TRANSLATIONS : "model_id"
  ADMINS o|--o{ PROMPT_TEMPLATES : "created_by / updated_by"
  DICTIONARY_ITEMS o|--o{ PROMPT_TEMPLATES : "industry_id / style_id"
  DICTIONARY_ITEMS o|--o{ PROMPT_TEMPLATES : "industry_id"
  DICTIONARY_ITEMS o|--o{ PROMPT_TEMPLATES : "style_id"
  ADMINS o|--o{ PROMPT_TEMPLATES : "created_by / updated_by"
  USERS o|--o{ CS_VISITORS : "merged_user_id"
  USERS o|--o{ CS_CONVERSATIONS : "customer_user_id"
  CS_VISITORS o|--o{ CS_CONVERSATIONS : "visitor_id"
  CS_VISITORS o|--o{ CS_CONVERSATIONS : "origin_visitor_id"
  ADMINS o|--o{ CS_CONVERSATIONS : "agent_admin_id"
  CS_CONVERSATIONS ||--o{ CS_CONVERSATION_CONTEXTS : "conversation_id"
  PROJECTS o|--o{ CS_CONVERSATION_CONTEXTS : "project_id"
  CS_CONVERSATIONS ||--o{ CS_MESSAGES : "conversation_id"
  CS_CONVERSATION_CONTEXTS o|--o{ CS_MESSAGES : "context_id"
  ADMINS o|--o{ CS_MESSAGES : "sender_admin_id"
  CS_MESSAGES ||--o{ CS_MESSAGE_TRANSLATIONS : "message_id"
  CS_CONVERSATIONS ||--o{ CS_EMAIL_OUTBOX : "conversation_id"
  ADMINS o|--o{ CS_SETTINGS : "updated_by"
```

客服上下文中的方案 `ref` 是方案编号文本，不是外键；`project_id` 是可选的实际外键。客服翻译用途通过 `ai_model_assignments.purpose` 指向 AI 模型。邮件 outbox、设置及翻译状态属于投递与运营数据，不是会话消息本身。

## 运行、审计与支撑表

```mermaid
erDiagram
  FOUNDATION_TASKS {
    uuid id PK
    text request_key UK
    text kind
    text status
    jsonb payload
  }
  FOUNDATION_OUTBOX {
    uuid id PK
    uuid task_id FK_UK
    timestamptz published_at
  }
  SCHEMA_MIGRATIONS {
    text version PK
    text checksum
    timestamptz applied_at
  }
  ADMIN_AUDIT_LOGS {
    uuid id PK
    uuid admin_id FK
    text target_type
    text target_id
  }
  DICTIONARIES {
    uuid id PK
    text code UK
  }
  DICTIONARY_ITEMS {
    uuid id PK
    uuid dictionary_id FK
    text item_value
  }
  SIGN_IN_CONFIG {
    boolean id PK
    boolean enabled
    integer daily_amount
    text timezone
  }
  PROJECT_ASSIGNMENT_CONFIG {
    boolean id PK
    uuid default_assignee_admin_id FK
    uuid updated_by FK
    integer revision
  }
  PROJECT_OPERATIONS {
    text actor_type PK
    uuid actor_id PK
    text operation PK
    text target PK
    text request_key PK
  }
  SCHEME_SELECTION_MIGRATION_BACKUP {
    uuid id
    text code
    jsonb legacy_values
  }
  SCHEME_OPENING_DIRECTIONS_ARCHIVE {
    uuid scheme_id
    text_array opening_directions
  }
  RETIRED_SIZE_DICTIONARY_BACKUP {
    jsonb dictionary
    jsonb item
  }
  IMPORTED_DIMENSION_ORIENTATION_BACKUP {
    uuid id
    text code
  }
  FOUNDATION_TASKS ||--o| FOUNDATION_OUTBOX : "task_id"
  ADMINS ||--o{ ADMIN_AUDIT_LOGS : "admin_id"
  DICTIONARIES ||--o{ DICTIONARY_ITEMS : "dictionary_id"
```

`schema_migrations` 由迁移 runner 创建，不在编号 SQL 迁移中。`catalog_options_legacy` 是迁移 012 将旧 `catalog_options` 改名后保留的历史表；下列 `_backup` / `_archive` 表用于迁移数据留档，不属于活跃业务写模型。

数据库还包含以下支撑实体：

- `booth_sizes` 不是独立表，是 `dictionaries` / `dictionary_items` 中 `booth_size` 字典及其尺寸字段。
- `bom_change_logs`、`scheme_imports`、`admin_audit_logs`、`sign_in_config`、`project_assignment_config` 等活跃支撑表已纳入[全量表设计目录](全量表设计目录.md)。
- 主题任务缓存和选型关联通过 `theme_jobs` 的 `cache_key`、`cached_from_job_id`、`search_id` 等字段表达，不另设缓存或检索表。
- 积分对账问题通过 `theme_jobs`、`artwork_jobs` 的 `credit_issue` 字段和积分模块的重充幂等记录表达。
- `foundation_tasks` / `foundation_outbox` 是基础设施示例任务。

需要核对完整字段、索引和删除动作时，直接查看 `apps/server/migrations/` 中按序执行的迁移；本图不替代迁移文件或数据库 introspection。
