# 请求认证与会话策略

## 认证入口

`http/authentication.ts` 在客户端和管理端注册请求级认证，调用 `modules/identity/principal.ts` 生成 `request.principal`。每个请求读取一次 Redis Session 和本地账户状态；路由通过 `clientUserId`、`adminUserId` 或 `requirePrincipal` 获取身份，不重复读取 Session。

- 客户端公共页面允许不带凭据的访客；一旦提供凭据，必须认证成功，不将失效或禁用身份静默降级为访客。
- 管理端业务和 `/me` 必须有启用账户及 `ROLE_ADMIN`。
- 登录、外部 token 同步和登出通过路由配置声明公共入口。登出幂等，账户禁用后仍可清除 Session。
- 不存在、过期、撤销、格式不完整或跨门户 Session 返回 `401 / AUTH_REQUIRED`。跨门户请求不会删除另一门户的有效 Session。
- 禁用/不存在的本地账户、缺少管理员角色返回 `403 / ACCESS_DENIED`，同时删除当前 Session。

## 账户禁用与撤销

迁移 `051_account_session_versions.sql` 为 `users`、`admins` 增加 `session_version`。Session 建立时保存版本，每次请求与账户当前版本比对。

- 数据库触发器在启用→禁用、外部身份变化或管理员角色移除时增加版本，因此所有旧 Session 都失效；重新启用或恢复角色不会恢复旧 Session。
- 资料同步保留本地禁用状态，登录和 `/me` 均不能利用外部启用资料重新启用本地账户。
- `/me` 确认外部身份失效或权限撤销时递增账户版本并删除当前 Session；上游临时故障不撤销身份。
- 登出只撤销当前 Session。需要撤销某账户全部会话时调用 `revokeAccountSessions`。
- 本次发布前没有版本字段的 Session 失效，需要重新登录。

主题/画稿事件票据在 Redis 中绑定原 Session token，连接时原子消费并重新认证。禁用、登出、会话过期或版本撤销后，未使用票据不能再连接。已开始的请求和 SSE 使用建立时的 principal，后续 HTTP 请求重新认证；已接受的生成任务继续执行与结算。

## 业务权限与限流

对象归属在业务服务/仓储查询中按用户 ID 检查，包括主题任务详情与选择、画稿、项目、报价和检索关联。principal 只证明请求身份，不替代资源权限，Worker/其他调用方同样经过业务校验。

`http/rate-limits.ts` 集中维护 Redis 原子计数策略，超限统一返回 `429 / RATE_LIMITED` 及 `Retry-After`：

| 策略 | 窗口 | 上限 | 身份 |
| --- | --- | --- | --- |
| 登录与外部 token 同步 | 60 秒 | 20 | 门户 + IP，客户端两入口共享 |
| 主题/画稿费用提议与创建 | 60 秒 | 10 | 门户 + 用户，共享 |
| 询价 | 60 秒 | 10 | 门户 + 用户 |
| 人工需求 | 60 秒 | 10 | 门户 + 用户 |
| 智选 | 60 秒 | 60 | 门户 + IP |

`tests/request-authentication.test.ts` 验证禁用一致性、查询次数、会话撤销、事件票据、限流及业务归属；设置 `PROJECT_TEST_DATABASE_URL` 可运行真实 PostgreSQL 迁移/同步/撤销测试。
