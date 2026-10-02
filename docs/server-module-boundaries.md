# 服务端模块边界

服务端按业务领域组织实现，门户只负责 HTTP 接入。

| 目录 | 职责 |
| --- | --- |
| `apps/server/src/http/client` | 参展商路由、请求校验、会话身份提取、响应与 SSE 映射 |
| `apps/server/src/http/admin` | 管理端路由、请求校验、会话身份提取、响应映射 |
| `apps/server/src/http/su` | SU HTTP 入口 |
| `apps/server/src/modules/identity` | 账户同步、认证、账户查询 |
| `apps/server/src/modules/schemes` | 方案维护、导入、审核发布、BOM |
| `apps/server/src/modules/assets` | 资产与版本、公开资料可用性及下载 |
| `apps/server/src/modules/selection` | 字典、适用条件、需求解析与方案匹配编排 |
| `apps/server/src/modules/selection-analytics` | 选型尝试、解析、检索流水与统计 |
| `apps/server/src/modules/generation` | 主题与画稿任务、生成快照、执行与结算、任务查询 |
| `apps/server/src/modules/prompts` | 提示词匹配、维护、渲染与预览 |
| `apps/server/src/modules/credits` | 签到充值、积分账本、预占结算与对账 |
| `apps/server/src/modules/projects` | 询价、项目快照、报价与交付 |
| `apps/server/src/modules/tasks` | Foundation echo 任务业务 |
| `apps/server/src/workers` | Outbox 分发、队列恢复与调度 |
| `apps/server/src/infra` | 数据库、Redis、存储、会话和外部认证/AI 服务适配 |

## 依赖规则

- `app.ts` 注册 `http/` 路由；`worker.ts` 连接队列并调用业务与调度模块。
- HTTP 和 Worker 调用 `modules/`，业务模块不得导入 HTTP 门户、Fastify 或 Worker 调度入口。
- 各 HTTP 门户不得相互导入；跨门户能力在业务模块中共享。
- `infra/` 不依赖业务模块、HTTP 或 Worker 调度实现。
- 不保留旧 `modules/client`、`modules/admin`、`modules/su` 的兼容导出。

`tests/module-boundaries.test.ts` 使用 TypeScript AST 检查静态导入、动态导入和类型导入，防止反向依赖回归。

## 选型入口

`http/client/selection` 提取访客/登录身份、校验请求、限流及映射响应。
`modules/selection/service.ts` 编排字典加载、模型和提示词查询、需求解析、候选匹配以及流水记录。
业务服务接收普通输入与 `SelectionIdentity`，无需 Fastify 请求对象即可调用与测试。
