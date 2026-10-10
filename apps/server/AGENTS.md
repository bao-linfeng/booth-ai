# AGENTS.md — apps/server

跨项目信息（环境初始化、端口、前后端契约、全局约定）见根目录 [`AGENTS.md`](../../AGENTS.md)。本文件只记录该包独有的高信号事实。

## 关键架构入口

深入修改前先读对应代码：

- 模块依赖规则：`tests/architecture/module-boundaries.test.ts` 用 AST 静态检查强制执行：技术层方向、业务模块间依赖白名单（必须无环）与对外公开文件、关键表写入归属（规则摘要见下文“模块开发规范”）
- 认证体系：`src/http/authentication.ts` 统一建立请求级 principal，`src/modules/identity/principal.ts` 校验账户与 Session 版本
- 积分账本（预占、结算、释放）：`src/modules/credits/`，不读写生成任务表；job 行加锁由 `generation/credit-jobs.ts` 注入（`createJobLedger`，先锁用户再锁 job），任务与账本对账在 `generation/credit-reconciliation.ts`；违反账本不变量抛 `CreditInvariantError`（稳定 `code`，日志按 code 定位，不要改回普通 `Error`）
- 生成任务 Outbox 与恢复：`src/workers/generation-outbox.ts`（主题/画稿共用分发）、`generation-recovery.ts`（恢复矩阵 `decideRecovery`）
- 方案基线资产与用户生成素材的作用域隔离：`migrations/050_asset_scope.sql`（`scheme_baseline_assets` 视图）
- Worker 调度隔离、健康状态、指标与项目通知投递：`src/worker.ts`、`src/workers/scheduler.ts`、`metrics.ts`、`project-notifications.ts`
- 在线客服：`src/modules/customer-service/`（访客、会话、消息、翻译、邮件、保留期），访客令牌只经 HttpOnly Cookie 下发与读取（`src/http/client/customer-service/visitor-cookie.ts`，须带 `X-CS-Visitor` 头才读取），实时通道为共用 SSE `src/http/sse.ts`（进程内所有 SSE 共用一条 Redis 订阅连接，频道按引用计数订阅）；设计与落地调整见 [`docs/一期功能拆分/在线客服模块开发计划.md`](../../docs/一期功能拆分/在线客服模块开发计划.md)
- [`docs/一期功能拆分/AI模型接入与配置.md`](../../docs/一期功能拆分/AI模型接入与配置.md) — AI 供应商/模型/用途分配三层配置、协议注册表与适配器约定（业务代码不写供应商分支）

---

## 包信息

- **运行时**：Node 24（`engines: ">=24 <25"`），纯 ESM（`"type": "module"`）
- **包管理器**：npm（不要用 pnpm/yarn）
- **TypeScript**：`module: NodeNext`，`moduleResolution: NodeNext`，`strict: true`，`noUncheckedIndexedAccess: true`

---

## 开发命令

```powershell
npm run dev:api        # tsx watch src/api.ts（API，watch 模式）
npm run dev:worker     # tsx watch src/worker.ts（Worker，watch 模式）
npm run check          # tsc --noEmit（两套 tsconfig，源码 + 测试同时检查）
npm run build          # tsc → dist/
npm test               # tsx --test "tests/**/*.test.ts"（宿主机无测试库变量时集成测试会 skip，完整检查用 Docker check）
npx tsx --test tests/http/app.test.ts   # 单文件测试
npm run migrate        # 手动跑 DB 迁移（需 DB 已启动）
npm run smoke          # E2E 冒烟（需 Postgres + Redis + Silo S3 全部在线）
```

---

## 改动后必须重新部署 dev 栈

**改完 `apps/server`（代码或迁移）必须重新部署 dev 栈，无需询问**（在仓库根目录执行）：

```powershell
docker compose --env-file .env -f infra/compose.dev.yaml up -d --build
```

然后验证并汇报：`schema_migrations` 最新版本、`curl localhost:3000/health/ready`、worker 的 `/tmp/worker-status.json` 与日志。

原因：`src`/`migrations` 虽以只读方式挂载并由 `tsx watch` 运行，但 Windows bind mount 下文件变更事件不可靠、热重载常不生效；新迁移只在 `migrate` 服务重跑时执行；依赖/Dockerfile 变更必须重建镜像。容器 `healthy` 只说明进程在跑，**不代表代码是最新的**。仅改测试或文档时可跳过，但需说明。

---

## ESM 导入规则

**所有内部相对导入必须带 `.js` 扩展名**，即使源文件是 `.ts`：

```typescript
// ✅ 正确
import { buildApp } from './app.js';
import { createDatabase } from '../infra/database.js';

// ❌ 错误（运行时 resolve 失败）
import { buildApp } from './app';
```

---

## 两套 tsconfig

| 文件 | rootDir | 输出 | 用途 |
|------|---------|------|------|
| `tsconfig.json` | `src` | `dist/` | 生产构建 |
| `tsconfig.test.json` | `.`（项目根） | 无（`noEmit`） | 同时检查 `src/` 和 `tests/`，`npm run check` 跑两套 |

---

## 入口与进程边界

两个**独立进程**，共享 infra 层但不共享进程：

| 进程 | 入口 | 职责 |
|------|------|------|
| API | `src/api.ts` → `src/app.ts` | Fastify HTTP，薄 controller |
| Worker | `src/worker.ts` | BullMQ Worker + Outbox 轮询（每秒，批量 10） |

---

## 源码结构

```
src/
├── api.ts               # API 进程入口（Fastify 启动 + 优雅关闭）
├── worker.ts            # Worker 进程入口（BullMQ + Outbox 轮询 + 健康文件）
├── app.ts               # Fastify 工厂（CORS、Helmet、Swagger、错误处理、健康路由）
├── config.ts            # 环境变量解析（必填校验，失败退出，不回显值）
├── infra/
│   ├── database.ts      # pg.Pool（max:10, timeout:5s）+ transaction() helper
│   ├── redis.ts         # createRedis(config, 'worker'|'request')，角色决定重试策略
│   ├── storage.ts       # S3 双端点客户端 + getSignedUrl（公开端点专用）
│   ├── queue.ts         # Foundation、主题、画稿队列定义
│   └── ai/              # 协议注册表 protocols.ts、运行时配置与凭据 config.ts、Base URL 校验 endpoint.ts、providers/ 各协议适配器
├── http/
│   ├── admin/           # 管理端路由、校验、身份提取与响应映射
│   ├── client/          # 参展商路由、校验、身份提取与响应映射
│   └── su/              # SU 门户规划占位（未实现、未注册路由）
├── modules/             # identity / dictionaries / schemes / assets / selection（含 analytics 搜索记录）
│                        # generation / prompts / credits / projects / customer-service / dashboard / tasks 业务模块
│                        # client-sign-in、prompt-preview 是跨模块用例的编排模块
├── workers/             # Outbox 分发、队列恢复与调度
└── scripts/
    ├── migrate.ts       # advisory lock 19002401 + SHA-256 校验和，按文件名字母序执行
    ├── storage-init.ts  # S3 bucket 创建/校验，含指数退避
    └── smoke.ts         # E2E 冒烟验证全链路
```

---

## 当前已注册路由

```
GET  /health/live                    → { status: 'ok' }（liveness）
GET  /health/ready                   → { status: 'ok'|'degraded', checks: {database,redis,storage} }（readiness，503 on degraded）
GET  /openapi.json                   → OpenAPI schema（仅 NODE_ENV != production）
GET  /docs                           → Swagger UI（仅 NODE_ENV != production）
POST /api/v1/client/auth/login       → 参展商登录（外部 SSO，返回 accessToken）
POST /api/v1/client/auth/logout      → 参展商登出（清除 Redis session）
GET  /api/v1/client/me               → 参展商当前用户信息
POST /api/v1/admin/auth/login        → 管理端登录（外部 SSO + 角色校验，返回 accessToken）
POST /api/v1/admin/auth/logout       → 管理端登出（清除 Redis session）
GET  /api/v1/admin/me                → 管理端当前用户信息
```

业务路由在 `http/client/index.ts`、`http/admin/index.ts` 中注册；上述仅列出基础认证路由。

---

## 迁移规则

- 文件在 `migrations/`，命名格式：`^\d+_.+\.sql$`，按字母序执行
- **已执行的文件禁止修改**（SHA-256 校验和，改了会抛错）
- 新迁移只能追加新文件
- 当前 schema 以 `migrations/` 下文件为准，不在文档中维护表结构

---

## 队列 / Outbox 约束

- 队列定义在 `src/infra/queue.ts`：`booth-foundation`、`booth-theme`、`booth-artwork`、`booth-cs`（在线客服翻译；`cs_message_translations` 的 pending 行即 outbox，由 `cs-translation-outbox` 调度任务投递）
- `jobId` = `taskId`（BullMQ 去重，重试幂等）
- Task 写入 + Outbox 写入必须在**同一事务**内
- **调用 AI/外部 API 时不得持有 DB 锁**
- Worker 调度分两条执行链（`src/workers/scheduler.ts` 的 lane）：默认链 `dispatch` 跑 Outbox 分发、恢复、对账、坐席巡检；`background` 链跑邮件、Webhook、客服保留期与指标。链间并发、链内顺序，调度最多占 2 个数据库连接。会调用外部服务的新任务放 `background`，避免拖慢分发
- 外部投递批次（邮件、Webhook）必须走 `workers/leased-batch.ts` 的 `processLeased`：只在租约还够一次最坏耗时时才开始下一条；渠道不可达时停止本批。剩余条目释放租约，并退回已计入的尝试次数，避免多副本重复领取、重复发送
- Worker 健康文件：健康评估在独立的 1 秒循环中执行，不等待调度链；健康时写 `/tmp/worker-ready`（compose healthcheck 依赖其 mtime），Redis 断连或关键任务超过 `staleAfterMs` 未成功时删除；详细状态（含各任务所在链、`runningForMs`）写 `/tmp/worker-status.json`
- Worker 停机：收到 SIGTERM 后不再接新任务，生成任务在下一次供应商调用前的检查点让出（`GenerationInterruptedError` → `moveToDelayed`，不消耗重试次数，租约立即释放），进行中的调用会跑完；`worker.ts` 170 秒后兜底退出。换主题只在尚未出图时让出，已出图的跑完以免张数缩水。容器停止等待须 ≥ 180 秒（dev compose 已配置），且信号必须直达 node：dev compose 的 Worker 用 `node --import tsx` 启动，不要改回 `npm run dev:worker`（`tsx watch` 收到信号 5 秒后强杀子进程）

---

## Redis 角色差异

| 角色 | `maxRetriesPerRequest` | `enableOfflineQueue` | `commandTimeout` |
|------|----------------------|---------------------|-----------------|
| `'worker'` | `null`（无限重试）| `true` | — |
| `'request'` | `1`（快速失败）| `false` | 5000ms |

API 进程用 `'request'`，Worker 进程用 `'worker'`，**不要混用**。

---

## 环境变量

`config.ts` 解析与校验，失败时进程退出且只报字段名、不回显值。

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL URI（`postgres://` 或 `postgresql://`） |
| `REDIS_URL` | Redis URI（`redis://` 或 `rediss://`） |
| `CORS_ORIGINS` | 逗号分隔的允许来源 |
| `S3_ENDPOINT` | S3 内部端点（如 `http://silo:9000`），仅容器内调用 |
| `S3_PUBLIC_ENDPOINT` | S3 公开端点，仅用于 `getSignedUrl` 生成给浏览器的 presigned URL |
| `S3_REGION` | 默认 `us-east-1` |
| `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Bucket 与凭据 |

可选：`NODE_ENV`（默认 `development`）、`HOST`（默认 `0.0.0.0`）、`PORT`（默认 `3000`）、`LOG_LEVEL`（默认 `info`）、`PROJECT_NOTIFICATION_WEBHOOK_URL` / `PROJECT_NOTIFICATION_WEBHOOK_SECRET`（未配置时项目通知停留在 `project_notification_outbox`，见 `src/worker.ts`）。

- `TRUST_PROXY`：反向代理信任范围，填代理跳数（如 `1`）或逗号分隔的 IP/CIDR/关键字（`loopback`/`linklocal`/`uniquelocal`）。默认不信任，`request.ip` 为直连地址；部署在代理后必须配置，否则按 IP 的限流（登录、智选、匿名询价）会共用代理地址。
- 回执邮件（询价/人工需求受理）与在线客服邮件（离线留言通知、回复提醒，outbox 为 `cs_email_outbox`）共用以下配置：`SMTP_HOST` / `SMTP_PORT`（默认 465，非 465 默认 STARTTLS）/ `SMTP_SECURE` / `SMTP_USER` + `SMTP_PASSWORD` / `SMTP_FROM`，以及邮件链接用的 `CLIENT_PUBLIC_URL`（生产须 https）。未配置 `SMTP_HOST` 时邮件停留在 `project_receipt_emails`；同一收件人 24 小时最多入队 5 封。

日志：Fastify 已关闭请求日志（`disableRequestLogging: true`），headers 中 `authorization`/`cookie` 已脱敏。

---

## 测试

- Runner：Node 原生 `node:test`，**不是 Jest/Vitest**
- 测试按类型分目录（`tests/architecture/test-layout.test.ts` 检查）：
  - `architecture/`：依赖边界与目录约束。
  - `unit/`：纯逻辑与内存替身。
  - `http/`：`fastify.inject()` 路由测试，无需外部服务。
  - `integration/`：凡是读取 `*_TEST_DATABASE_URL` / `*_TEST_REDIS_URL` 的测试都放这里。
  - `helpers/`：fixtures 与测试库初始化。
- `npm run smoke`：需要 Postgres 17、Redis 7.4、Silo S3 全部运行
- **标准检查是 Docker `check` 服务**（命令见根目录 `AGENTS.md`）：`npm run check` → `tests/helpers/setup-integration-db.ts` → 全部测试（与 `npm test` 同一 glob，命令写在 compose 中，并断言收集到的测试数大于 0）→ `npm run build`。改了 `package.json` 依赖或脚本后需 `docker compose ... build check` 重建镜像。它注入全部 `*_TEST_DATABASE_URL`（统一指向独立库 `booth_test`）与 `THEME_TEST_REDIS_URL` / `CS_TEST_REDIS_URL`（Redis 15 号库），并设置 `REQUIRE_INTEGRATION_TESTS=1`，因此集成测试必须执行，结果应为 `skipped 0`。
- `tests/helpers/setup-integration-db.ts` 每次检查都会删除并重建 `booth_test`、在 `public` 执行全部迁移（BOM、通知收件箱等测试直接使用 `public`），并清空 Redis 测试库；脚本只接受名称以 `_test` 结尾的库和非 0 号 Redis 库，不会触碰开发库 `booth`。
- 宿主机直接 `npm test` 时这些变量缺失，集成测试会 `skip`，**本地通过不代表集成测试跑过**；`tests/integration/integration-env.test.ts` 在 `REQUIRE_INTEGRATION_TESTS=1` 时校验变量齐全，缺项直接失败。变量清单从测试源码中的 `process.env.*_TEST_(DATABASE|REDIS)_URL` 自动收集（`tests/helpers/integration-env.ts`），新增集成测试变量后须同步加到 `infra/compose.dev.yaml` 的 `check` 服务。
- 集成测试按文件并行，读系统目录（`pg_constraint`、`information_schema` 等）时必须限定当前 schema（如 `connamespace = current_schema()::regnamespace`），否则会读到其他测试的临时 schema。
- **新增权限码必须同时追加迁移补授给 `ROLE_ADMIN`**（参考 `072_grant_sign_in_config_to_admin.sql`，已拥有时不改 revision）。`admin-roles-integration.test.ts` 断言执行全部迁移后 ROLE_ADMIN 拥有全部权限码，漏写迁移会失败；只执行到某个历史迁移的测试要按该迁移当时的权限集合断言（见 `introducedAfter061`）。
- 修改核心逻辑后必须确保 `check` 服务通过（推送前 lefthook 也会在 `apps/server`、`infra` 有改动时执行它）

---

## 模块开发规范

- 新增业务路由：在对应 `src/http/{admin|client}/<功能>/index.ts` 实现并在门户 `index.ts` 注册；复杂请求/响应契约可拆到同目录 `schema.ts`。不要再新增 `*.controller.ts` 这类平铺文件
- Controller 保持薄：只做解析和响应，业务逻辑放 service 层；`src/http` 内不得直接执行 SQL 或开启事务（边界测试检查）
- 管理端路由权限在路由配置就近声明：`config: { permissions: ['schemes.read'] }`（类型为 `PermissionCode`，拼错会编译失败）。语义是任一权限码已授予即可进入，`[]` 表示任何已登录管理员；未声明的非公开路由一律 403。hook 只检查声明的权限码本身，不复核依赖闭包；需要依赖闭包或细粒度判断（资产类型、修改字段、对象归属）时，在 handler / route preHandler 里调用 `requireAdminPermission`。依赖闭包由角色保存校验和 `admin-roles-integration` 的迁移断言保证
- 成功响应 schema 用 `src/http/schemas.ts` 的 `successResponse(...)`。声明后 Fastify 会按 schema 序列化并丢弃未声明字段，所以必须覆盖前端用到的全部字段，并在测试里比对序列化结果（参考 `tests/http/http-contract.test.ts`）。错误响应 schema 由 `src/http/errors.ts` 自动挂到所有路由，路由不要再自定义 errorHandler 或手写错误体
- 共享业务放 `src/modules/` 领域模块，禁止导入 HTTP 门户、Fastify 或 Worker 调度实现；`infra/` 禁止反向导入业务模块
- 业务代码按领域放进 `src/modules/<领域>/`，不要按门户（admin/client/su）建目录
- 业务模块之间的依赖在 `tests/architecture/module-boundaries.test.ts` 的 `moduleRules` 中声明：`dependsOn` 必须无环，其他模块只能导入 `exposes` 列出的文件。新增跨模块依赖时，先确认被依赖方不需要了解调用方；跨模块用例放到上层编排模块，例如登录后的游客数据归属放在 `client-sign-in`，不要放进 identity
- 表写入归属：`credit_transactions`/`credit_reservations` 只由 `modules/credits` 写入，生成任务表（`theme_job*`/`artwork_job*`）只由 `modules/generation` 与 `workers/generation-*` 写入，其他模块只能读；同一测试会检查
- `tests/architecture/module-boundaries.test.ts` 检查上述依赖边界
- 新 Job 类型：在 `src/infra/queue.ts` 追加 `TASK_NAME` 常量，Worker 在 `src/worker.ts` 注册处理器
- 智选匹配/解析返回给用户的提示文案（理由、差异、澄清问题等）集中在 `src/modules/selection/messages/`（12 种语言，以 `zh.ts` 的 key 为准，缺 key 会编译失败），按 `Accept-Language` 输出；新增文案不要在 match/parse/llm 里写死中文。
