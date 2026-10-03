# AGENTS.md — apps/server

跨项目信息（环境初始化、端口、前后端契约、全局约定）见根目录 [`AGENTS.md`](../../AGENTS.md)。本文件只记录该包独有的高信号事实。

## 关键架构文档

深入修改前先读对应文档：

- [`docs/server-module-boundaries.md`](../../docs/server-module-boundaries.md) — 模块职责与依赖规则（`tests/module-boundaries.test.ts` 用 AST 静态检查强制执行，反向依赖会导致测试失败）
- [`docs/server-authentication.md`](../../docs/server-authentication.md) — 认证体系：`http/authentication.ts` 统一建立请求级 principal，`modules/identity/principal.ts` 校验账户与 Session 版本
- [`docs/credit-invariants.md`](../../docs/credit-invariants.md) — 积分账本不变量（预占、结算、对账）
- [`docs/theme-outbox-recovery.md`](../../docs/theme-outbox-recovery.md) — 生成任务 Outbox 恢复机制
- [`docs/asset-scope.md`](../../docs/asset-scope.md) — 方案基线资产与用户生成素材的作用域隔离
- [`docs/worker-observability.md`](../../docs/worker-observability.md) — Worker 调度隔离、健康状态、指标、链路追踪与项目通知投递
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
npm test               # tsx --test tests/*.test.ts（不需要外部服务）
npx tsx --test tests/app.test.ts   # 单文件测试
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
│   └── su/              # SU HTTP 入口
├── modules/             # identity / schemes / assets / selection / selection-analytics
│                        # generation / prompts / credits / projects / tasks 业务模块
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

- 队列定义在 `src/infra/queue.ts`：`booth-foundation`、`booth-theme`、`booth-artwork`
- `jobId` = `taskId`（BullMQ 去重，重试幂等）
- Task 写入 + Outbox 写入必须在**同一事务**内
- **调用 AI/外部 API 时不得持有 DB 锁**
- Worker 健康文件：成功迭代写 `/tmp/worker-ready`（compose healthcheck 依赖其 mtime），Redis 断连或分发失败时删除；详细状态写 `/tmp/worker-status.json`

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

可选：`NODE_ENV`（默认 `development`）、`HOST`（默认 `0.0.0.0`）、`PORT`（默认 `3000`）、`LOG_LEVEL`（默认 `info`）、`PROJECT_NOTIFICATION_WEBHOOK_URL` / `PROJECT_NOTIFICATION_WEBHOOK_SECRET`（见 `docs/worker-observability.md`）。

日志：Fastify 已关闭请求日志（`disableRequestLogging: true`），headers 中 `authorization`/`cookie` 已脱敏。

---

## 测试

- Runner：Node 原生 `node:test`，**不是 Jest/Vitest**
- `tests/app.test.ts`：`fastify.inject()` 路由测试，无需外部服务
- `npm run smoke`：需要 Postgres 17、Redis 7.4、Silo S3 全部运行
- `*-integration.test.ts` 及部分 DB 测试在环境变量缺失时会 `skip`（`npm test` 与 Docker `check` 默认都不设置），**测试通过不代表它们跑过**。按需设置 `PROJECT_` / `THEME_` / `CREDIT_` / `ARTWORK_` / `ASSET_` / `BOM_` / `PROMPT_TEMPLATE_` / `AI_MODEL_` + `TEST_DATABASE_URL`，以及 `THEME_TEST_REDIS_URL`
- 修改核心逻辑后必须确保 `npm run check && npm test` 通过

---

## 模块开发规范

- 新增业务路由：在对应 `src/http/{admin|client|su}/` 子目录实现，注册到 Fastify（参考 app.ts 的 plugin 模式）
- Controller 保持薄：只做解析和响应，业务逻辑放 service 层
- 共享业务放 `src/modules/` 领域模块，禁止导入 HTTP 门户、Fastify 或 Worker 调度实现；`infra/` 禁止反向导入业务模块
- `src/modules/{admin,client,su}/` 只剩重构遗留的空目录，不要往里放代码；按业务领域放入对应模块
- `tests/module-boundaries.test.ts` 检查依赖边界，详见 [`docs/server-module-boundaries.md`](../../docs/server-module-boundaries.md)
- 新 Job 类型：在 `src/infra/queue.ts` 追加 `TASK_NAME` 常量，Worker 在 `src/worker.ts` 注册处理器
