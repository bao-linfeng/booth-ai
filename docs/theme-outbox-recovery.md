# 换主题任务分发与恢复

## 投递保证

Theme Outbox 与 Foundation 一样采用至少一次投递：事务锁定最多 10 条未发布事件及对应任务，使用固定 `jobId = theme_jobs.id` 入队，入队成功后才提交 `picked_at` 和 `queued` 状态。生产者使用 request 角色的 Redis 连接（5 秒命令超时、禁用离线队列），避免 Redis 故障时无限持锁。

- 入队失败：数据库事务回滚，下次扫描重试。
- 入队成功、提交失败或进程退出：数据库保留未发布事件；重投使用相同 ID，BullMQ 去重。
- 已开始或已终态的数据库任务：仅确认遗留事件，不重新入队。
- 消费端保留终态检查和事务性积分结算；终态重投不再次生图或扣费。

## 对账恢复

Worker 启动时及此后每分钟，对账最多 10 条超过 15 分钟仍为 `pending/queued` 的任务：补建缺失 Outbox 或清除旧 `picked_at`，并刷新任务的对账时间（`updated_at`）。新增迁移 `046_theme_outbox_reconciliation.sql` 提供待分发任务的部分索引。

恢复后的事件走同一分发入口：

- Redis 记录不存在：重新入队。
- 同 ID 记录仍在等待、延迟或执行：固定 ID 去重，不移除活动任务。
- 同 ID 记录已失败或完成，但数据库仍待执行：对已有记录执行 `retry`，避免 `add` 去重导致无法恢复。

恢复保留原积分预占。任务最终失败时，任务状态和预占释放在同一数据库事务中提交；成功任务不会被失败回调覆盖。

## Theme / Artwork 执行恢复

两类任务共用数据库执行租约（15 分钟）、首次执行起算的总时限（30 分钟）及队列指数退避（2 秒起，3 次）。并发消费者遇到占用中的租约会返回可重试错误，不能把任务误确认成已完成。续租不会延长总时限。

Theme 保留业务模型切换，Artwork 保留四个方向的独立验收。共享供应商适配层负责请求超时、响应解析、错误分类及安全下载：

- 提交前持久化提交标记。同步请求网络中断、5xx 或响应无法解析时，将结果视为未知，不自动重提交，也不切换模型继续产生费用。
- Theme 的万相异步任务持久化供应商任务 ID；恢复时继续查询原任务。Gemini 每次生成的结果分别持久化，避免后续请求失败丢失前面结果。
- 重试先读取持久化结果。即使只生成了部分 Theme 图片，也不为了补足数量重新提交；Artwork 已生成方向直接重试下载和上传。
- 图片下载与轮询请求最多 30 秒，生成请求最多 180 秒，同时受总时限约束。下载禁止重定向，只允许供应商 HTTPS 域名；流式读取限制 30 MiB，解码限制 4000 万像素，拒绝动画与非 PNG/JPEG/WebP，按真实格式解码并统一输出 PNG。Artwork 额外保留 1536×1024 最低分辨率要求，并要求宽高比为 16:9（容差 2%，否则该方向以 `ARTWORK_ASPECT_INVALID` 失败）。
- 临时下载或存储故障保留生成结果供队列重试；验收不合格的图片不计费。Theme 每张验收并上传成功后独立落库，最终结算事务只处理积分及终态。
- 进度通知在对应状态落库后发送，失败不能决定任务成功与否；供应商错误日志只记录任务 ID、供应商和错误码，不包含响应正文、凭据或签名 URL。

Worker 每分钟扫描无有效租约的 `running/settling` 任务：总时限以内恢复缺失或已结束的队列记录；超过总时限按已落库可用结果结算，剩余预占释放。迁移 `049_generation_recovery.sql` 新增总时限及 Theme 提交记录，并将旧执行中、无生成结果的任务标记为上游结果未知。

## 验证

- `npm run check`、`npm test`：类型检查及常规测试。
- 设置 `THEME_TEST_DATABASE_URL` 和 `THEME_TEST_REDIS_URL` 后执行 `npx tsx --test tests/theme-outbox-integration.test.ts tests/theme-cache-integration.test.ts`。
- 集成测试使用独立 PostgreSQL schema 和唯一队列，结束后清理；覆盖真实 Redis 入队失败、延迟约束导致 COMMIT 失败、子进程在入队前/后被终止、并发分发锁、遗留任务恢复、队列终态记录恢复、积分释放原子性及已完成任务的重复消费幂等。
- 设置 `THEME_TEST_DATABASE_URL` / `ARTWORK_TEST_DATABASE_URL` / `CREDIT_TEST_DATABASE_URL` 后运行 `tests/generation-recovery-integration.test.ts`、`tests/artwork-delivery-integration.test.ts`、`tests/credit-invariants-integration.test.ts`，覆盖部分上传失败、恢复不再调用供应商、异步继续轮询、并发租约、通知失败、临时下载故障及超时部分结算。
