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
| `apps/server/src/modules/selection` | 字典、需求解析与方案匹配编排 |
| `apps/server/src/modules/selection-analytics` | 选型尝试、解析、检索流水与统计 |
| `apps/server/src/modules/generation` | 主题与画稿任务、生成快照、执行与结算、任务查询 |
| `apps/server/src/modules/prompts` | 提示词匹配、维护、渲染与预览 |
| `apps/server/src/modules/ai-models` | AI 供应商、模型与用途分配的后台维护，模型列表拉取 |
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

## 生成入口

`http/client/theme-jobs` 与 `http/client/artwork-jobs` 保留请求 schema、身份提取、限流、日志和 HTTP/SSE 响应映射。
`modules/generation/{theme,artwork}/offers.ts` 负责生成能力、报价快照、积分报价和 Redis offer 存取（TTL 300 秒）。
`submission.ts` 接收普通业务输入，先处理请求重放，再加载 offer 并调用事务服务校验和创建任务；已受理请求可在 offer 过期后重放。
`service.ts` 保持 offer 归属/参数/快照校验及任务、Outbox、积分预占的事务边界，业务模块不依赖 HTTP 请求对象。

## 资产管理入口

`http/admin/assets` 保留路由 schema、multipart 读取与字段解析、身份提取和响应映射。
`modules/assets/queries.ts` 负责公共基线资产及版本查询、SQL 列定义和结果映射；`types.ts` 定义资产输入与结果类型。
`service.ts` 负责资产变更事务，`metadata.ts` 校验业务元数据，`pairing.ts` 负责效果图/蒙版配对及排序联动。
`upload.ts` 负责文件检查、图片信息读取、摘要计算、存储写入、调用变更用例和落库失败后的存储补偿。
资产变更持有方案行锁，并在同一事务客户端上调用方案模块的 `invalidatePublication()`，使发布失效与资产变更原子提交或回滚。

## 方案导入入口

`http/admin/scheme-imports` 负责 multipart 读取、扩展名校验、身份提取和响应映射。
`modules/schemes/imports/workbook.ts` 读取 Excel 并转换单元格与单位；`validation.ts` 负责行校验、字典标签解析和预览行还原。
`preview.ts` 编排解析、行分类、重复方案版本快照与预览落库；`commit.ts` 负责幂等提交，并保持整批一个事务、每行一个 `SAVEPOINT` 的语义。
导入、新增及编辑统一调用 `modules/selection/sizes.ts` 的 `ensureSelectionSizes()`，经 `dictionaries.ts` 写入开口面数与长×宽×高整体尺寸字典。导入标签经 `dictionary-language.ts` 按编码、默认名称、翻译名称及别名归一化为 ID；未知或歧义标签在预览阶段报错。

## 认证入口

`http/authentication.ts` 统一建立请求级 principal，业务路由只提取身份；`modules/identity/principal.ts` 校验账户和 Session 版本，领域服务保留对象归属校验。认证、禁用、会话撤销和限流策略见 [server-authentication.md](./server-authentication.md)。
