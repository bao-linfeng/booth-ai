# AGENTS.md — apps/server

通用约定见根目录 [`AGENTS.md`](../../AGENTS.md)。本文件只记录该包独有的高信号事实。

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

## 容器重建规则

**修改 `apps/server/src/` 下的任何源码后，必须重建并重启 API/Worker 容器，否则容器内跑的仍是旧代码。**

```powershell
# 重建 API 容器（最常用）
docker compose --env-file .env -f infra/compose.dev.yaml build api
docker compose --env-file .env -f infra/compose.dev.yaml up -d api

# 重建 Worker 容器
docker compose --env-file .env -f infra/compose.dev.yaml build worker
docker compose --env-file .env -f infra/compose.dev.yaml up -d worker

# 同时重建两者
docker compose --env-file .env -f infra/compose.dev.yaml build api worker
docker compose --env-file .env -f infra/compose.dev.yaml up -d api worker
```

> 容器 `STATUS` 显示 `healthy` 只说明进程在跑，**不代表代码是最新的**。

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
│   └── image-provider.ts # 外部图像生成、轮询、下载与图像校验
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

## 数据库 Schema（当前）

**`foundation_tasks`**
- `id` uuid PK，`request_key` text UNIQUE（幂等键），`kind` text CHECK(`system.echo`)
- `status` text DEFAULT `'pending'` CHECK(`pending|running|succeeded|failed`)
- `payload` jsonb，`result` jsonb nullable，`error_code` text nullable

**`foundation_outbox`**
- `id` uuid PK，`task_id` uuid UNIQUE FK → `foundation_tasks(id)` ON DELETE CASCADE
- `published_at` timestamptz nullable（null = 待分发）
- 索引：`foundation_outbox_pending_idx ON (created_at) WHERE published_at IS NULL`

**`schema_migrations`**（由 migrate.ts 自动创建）
- `version` text PK，`checksum` text，`applied_at` timestamptz

---

## 迁移规则

- 文件在 `migrations/`，命名格式：`^\d+_.+\.sql$`，按字母序执行
- **已执行的文件禁止修改**（SHA-256 校验和，改了会抛错）
- 新迁移只能追加新文件
- 当前：`001_foundation.sql`

---

## 队列 / Outbox 约束

- 队列名：`booth-foundation`，Job 类型：`system.echo`
- `jobId` = `taskId`（BullMQ 去重，重试幂等）
- Task 写入 + Outbox 写入必须在**同一事务**内
- **调用 AI/外部 API 时不得持有 DB 锁**
- Worker 健康文件：成功迭代写 `/tmp/worker-ready`，Redis 断连或分发失败时删除

---

## Redis 角色差异

| 角色 | `maxRetriesPerRequest` | `enableOfflineQueue` | `commandTimeout` |
|------|----------------------|---------------------|-----------------|
| `'worker'` | `null`（无限重试）| `true` | — |
| `'request'` | `1`（快速失败）| `false` | 5000ms |

API 进程用 `'request'`，Worker 进程用 `'worker'`，**不要混用**。

---

## S3 双端点

- `S3_ENDPOINT`：容器内部调用（如 `http://silo:9000`）
- `S3_PUBLIC_ENDPOINT`：仅用于 `getSignedUrl`，暴露给浏览器
- **禁止将容器内部 hostname 通过 presigned URL 传给前端**

---

## 测试

- Runner：Node 原生 `node:test`，**不是 Jest/Vitest**
- `tests/app.test.ts`：`fastify.inject()` 路由测试，无需外部服务
- `npm run smoke`：需要 Postgres 17、Redis 7.4、Silo S3 全部运行
- 修改核心逻辑后必须确保 `npm run check && npm test` 通过

---

## 错误响应格式

所有错误统一格式，不得泄露内部细节：

```json
{ "error": { "code": "VALIDATION_ERROR|REQUEST_ERROR|INTERNAL_ERROR", "message": "...", "requestId": "..." } }
```

---

## 模块开发规范

- 新增业务路由：在对应 `src/http/{admin|client|su}/` 子目录实现，注册到 Fastify（参考 app.ts 的 plugin 模式）
- Controller 保持薄：只做解析和响应，业务逻辑放 service 层
- 共享业务放 `src/modules/` 领域模块，禁止导入 HTTP 门户、Fastify 或 Worker 调度实现；`infra/` 禁止反向导入业务模块
- `tests/module-boundaries.test.ts` 检查依赖边界，详见 [`docs/server-module-boundaries.md`](../../docs/server-module-boundaries.md)
- 新 Job 类型：在 `src/infra/queue.ts` 追加 `TASK_NAME` 常量，Worker 在 `src/worker.ts` 注册处理器
