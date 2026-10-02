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

此对账针对尚未开始的任务。`running/settling` 的执行中断仍由 BullMQ 的 stalled/retry 机制处理。

## 验证

- `npm run check`、`npm test`：类型检查及常规测试。
- 设置 `THEME_TEST_DATABASE_URL` 和 `THEME_TEST_REDIS_URL` 后执行 `npx tsx --test tests/theme-outbox-integration.test.ts tests/theme-cache-integration.test.ts`。
- 集成测试使用独立 PostgreSQL schema 和唯一队列，结束后清理；覆盖真实 Redis 入队失败、延迟约束导致 COMMIT 失败、子进程在入队前/后被终止、并发分发锁、遗留任务恢复、队列终态记录恢复、积分释放原子性及已完成任务的重复消费幂等。
