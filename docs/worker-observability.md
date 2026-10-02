# Worker 调度、健康与可观测性

## 调度隔离

`apps/server/src/workers/scheduler.ts` 按任务独立执行并捕获异常，一个调度器失败不会阻止其他调度器：

| 任务 | 间隔 | 失效阈值 | 关键 |
| --- | --- | --- | --- |
| `foundation-outbox` / `theme-outbox` / `artwork-outbox` | 1s | 30s | 是 |
| `generation-recovery` / `credit-reconciliation` / `theme-outbox-reconciliation` | 60s | 5min | 是 |
| `project-notifications`（仅配置通知渠道时） | 5s | 2min | 是 |
| `metrics` | 60s | — | 否 |

任务在同一循环中顺序执行，调度占用的数据库连接保持为一条。持续失败只在第 1 次及之后每 60 次记录错误日志，恢复时记录一次。

## 健康状态

- 健康条件：两条 Redis 连接 ready、Foundation/Theme/Artwork 三个 BullMQ Worker 均 `isRunning()`，且每个关键任务在失效阈值内成功过。
- `/tmp/worker-ready`：健康时每秒刷新 mtime（容器 healthcheck 使用），不健康时删除。
- `/tmp/worker-status.json`：每秒写入完整状态（各消费者、各任务最近成功/失败时间、连续失败次数、错误码、耗时）及最近一次指标快照，便于排查。

## API 就绪

`/health/ready` 的数据库检查要求镜像内 `migrations/` 中的每个迁移都已执行且校验和一致（`src/infra/migrations.ts`），而不只是检查 `001_foundation.sql`。

## 指标

`metrics` 任务每 60 秒输出一条 `Worker metrics` 结构化日志（同时写入状态文件）：

- `queues`：各 BullMQ 队列 waiting / active / delayed / failed / prioritized 数量。
- `jobs`：本窗口内各队列完成/失败数、排队等待时长与执行时长（均值、最大值）。
- `outbox`：Foundation / Theme / Artwork / 项目通知 Outbox 未发布数量与最早积压秒数；`projectNotificationsFailed` 为已放弃投递数量。
- `overdueCreditReservations`：任务已过执行截止或已终态但仍处于 `reserved` 的积分预占数量。
- `runningPhases`：运行中生成任务按阶段分组的数量及当前阶段最长持续秒数。

阶段耗时由 `refreshGeneration` 维护 `phase_started_at`，阶段切换时输出 `Generation phase completed`（含 `durationMs`）。

## 链路追踪

`requestId → jobId → providerRequestId`：

- 创建主题/画稿任务时将 Fastify 请求 ID 写入 `theme_jobs.request_id` / `artwork_jobs.request_id`，并在 API 日志输出 `generation job accepted`（含 `reqId` 与 `jobId`）。
- Worker 日志使用 `jobId`、`requestId`（取自任务行）；`Queue job completed/failed` 记录等待与执行耗时。
- 供应商响应中的请求 ID（`x-request-id` 头、DashScope `request_id`、Gemini `responseId`）写入 `theme_job_provider_attempts.provider_request_id` / `artwork_job_directions.provider_request_id` 并记入日志。记录失败不影响供应商结果判定。

## 日志口径

API 与 Worker 统一使用 pino 结构化日志（`src/infra/logger.ts`）。只记录标识符与稳定错误码（`errorCode()`：应用错误码、SQLSTATE、errno 名称），不记录错误消息、响应正文、凭据或签名 URL。

## 项目通知

`project_notification_outbox` 由 `project-notifications` 任务消费（`src/modules/projects/notifications.ts`、`src/workers/project-notifications.ts`）：

- 领取：单条语句 `FOR UPDATE SKIP LOCKED` 并设置 60 秒租约，投递期间不持有行锁。
- 失败：记录 `last_error_code`，按 30s × 2^(n-1)（上限 1 小时）退避；第 8 次失败后置 `failed_at`，不再自动重试，需人工处理。
- 成功：写入 `delivered_at`。崩溃可能导致重复投递，接收方按事件 ID 去重。
- 投递失败不影响项目受理。

具体通知渠道尚未确定（见《获取报价模块详细设计》4.4）。当前决定：一期暂不接入渠道，项目跟进以管理后台项目列表为准，生产环境不配置下列变量。当前提供通用 Webhook 适配器，通过以下环境变量启用；未配置时事件保留在 Outbox 中，Worker 启动时输出告警，指标中可见积压：

| 变量 | 说明 |
| --- | --- |
| `PROJECT_NOTIFICATION_WEBHOOK_URL` | 接收地址；生产环境必须为 https |
| `PROJECT_NOTIFICATION_WEBHOOK_SECRET` | 签名密钥，至少 32 字节；设置 URL 时必填 |

请求头：`x-booth-event-id`、`x-booth-timestamp`、`x-booth-signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`。5xx / 408 / 429 / 网络错误记为 `NOTIFICATION_UNAVAILABLE`，其他非 2xx 记为 `NOTIFICATION_REJECTED`，两者都会按退避重试。确定正式渠道后，在 Worker 中替换发送函数即可，领取、重试与投递状态逻辑保持不变。
