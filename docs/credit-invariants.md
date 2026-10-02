# 积分账本与任务事务不变量

## 账本规则

- 余额为 `SUM(credit_transactions.amount)`，可用余额为余额减去 `status='reserved'` 的预占总额。
- 共享业务入口为 `apps/server/src/modules/credits/service.ts`。调用方必须使用 `transaction()` 的同一个 `PoolClient`；统一按用户、任务、预占的顺序加锁。创建任务先锁用户，再写任务、预占与 outbox。
- 非缓存任务受理时预占 `requested_count × unit_credits`。两类任务共享用户锁，不能并发占用同一份可用余额。
- 可重试任务保留预占。下载、上传、SQL 或 COMMIT 失败不会单独释放积分；Theme 重试复用已经落库的生成 URL。
- 结算必须有归属、金额均匹配的有效预占。扣费不超过预占；按实际可用结果扣费，剩余部分解除冻结。已释放的预占不能直接扣费。
- 成功终态、结果、扣费流水和预占 `settled` 在同一事务完成；失败终态和预占 `released` 在同一事务完成。Artwork 已持久化的部分成功结果在最终收尾时仍按实际数量结算。
- 任务行锁以及已有的任务扣费唯一索引共同保证每任务最多一笔扣费。终态重放不再生成或扣费；失败与成功结算并发时只有先取得锁的一方可以完成状态迁移。
- 缓存命中不预占、不扣费。历史无定价、无预占、无扣费的成功任务不追溯扣费。

## 定期对账与故障恢复

Worker 启动后及每分钟调用 `reconcileJobCredits()`，每类任务每批最多检查 100 条，按 `credit_checked_at NULLS FIRST` 轮转，避免固定扫描前 100 条造成饥饿。多 Worker 通过用户/任务行锁串行修复同一任务。

自动修复范围：

1. failed 且没有扣费流水：释放残留预占。
2. 成功终态且扣费金额、用户、类型与定价和结果数量一致：将残留预占标记 settled。
3. 免费缓存任务且没有扣费流水：释放意外残留预占。
4. 非终态缺失/已释放预占：仅在用户当前可用余额足够时恢复完整预占；余额不足则报告异常，结算入口继续拒绝扣费。
5. 超过 15 分钟未更新的非终态：查询队列状态。failed/completed 时重试数据库收尾；任务仍 active/waiting/delayed/paused/waiting-children 时保留预占；队列任务丢失时以相同 jobId 重新投递，由 Worker 恢复处理。Artwork 仍受有效 lease 保护。

对账不凭任务时间直接释放预占，也不推测金额补记扣费。扣费与终态不匹配、预占归属错误、无法恢复预占等情况输出 `Credit reconciliation` 报告（任务 kind/id 与 reason），轮转后继续检查。处理这类历史异常时应核实原始流水与交付结果，再进行有记录的账务处理，不直接覆写原流水。

迁移 `047_credit_reconciliation_and_recharge.sql` 增加充值幂等键、对账轮转字段及索引，并修复已有 failed/无扣费任务的有效冻结；历史流水保留。

## 管理端充值接口

`POST /api/v1/admin/credits/recharge`

```json
{
  "requestKey": "一次充值意图的唯一键，推荐 UUID",
  "userId": "用户 UUID",
  "amount": 100,
  "note": "可选备注"
}
```

- `requestKey` 必填，1–200 字符且不能全为空白，作用域为当前管理员。
- 同管理员、同键、同 userId/amount/note 返回原流水，重试不增加余额。
- 同键不同参数返回 HTTP 409 / `REQUEST_CONFLICT`；缺失键返回 HTTP 400。
- 新充值使用新键；网络失败或响应丢失必须原参数原键重试。管理端弹窗成功前保留键，提交中的重复点击不再发起请求，成功后轮换键。
- 不给旧调用方生成服务端随机键；调用方必须按新契约提交。

## 验证

后端运行 `npm run check` 与 `npm test`。设置 `CREDIT_TEST_DATABASE_URL` 后，运行：

```powershell
npx tsx --test tests/credit-invariants-integration.test.ts
```

测试在随机隔离 schema 应用全部迁移，结束时清理。真实 PostgreSQL 覆盖延迟约束触发的 COMMIT 失败、跨任务类型并发预占、重复结算、失败与上传竞态、下载/存储重试耗尽、失败收尾故障后的对账补偿、历史已释放预占、部分成功、队列重试状态保留及充值并发/重放/参数冲突。该测试对队列状态使用可控桩；真实队列另由 `theme-outbox-integration.test.ts` 验证。
