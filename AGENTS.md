# AGENTS.md — 灵通 AI 展台方案平台

## 项目概览

AI 驱动的展台方案选型与成交平台，核心链路：描述需求 → AI 匹配方案 → 品牌调整 → 物料清单 → 询价交接。

双门户：参展商公众端（`apps/client`）+ 合作伙伴/管理端（`apps/admin`）。

---

## 仓库结构

```
booth-ai/
├── infra/                  # Docker Compose 开发环境（Postgres 17、Redis 7.4、Silo S3）
├── scripts/setup.ps1       # 一键初始化环境 + 启动
├── docs/                   # PRD、架构说明、一期功能拆分 API 文档
├── apps/
│   ├── server/             # 后端：Fastify 5 API + BullMQ 6 Worker（Node 24, TS ESM）
│   ├── client/             # 参展商前端：Vue 3.5 + Vite 6 + Tailwind CSS 3
│   ├── admin/              # 管理后台：Vben Admin 5 + Ant Design Vue 4（Turborepo）
│   └── shadcn-vue-admin-main/  # Shadcn-Vue 模板（独立子项目，有自己的 AGENTS.md）
└── lefthook.yml            # Git hooks
```

每个 `apps/*` 是独立包，**不要在根目录混用各子项目的命令**。

---

## 首次环境初始化

```powershell
# 生成 .env（含随机密码）、构建镜像、启动 DB/Redis/Silo、跑 migrate、启动 api/worker
./scripts/setup.ps1

# 只生成 .env，不启动容器
./scripts/setup.ps1 -SkipStart
```

`.env` 在根目录，**永远不要提交**。本地服务端口：

| 服务 | 地址 |
|------|------|
| API | `http://localhost:3000`（Swagger: `/docs`） |
| PostgreSQL | `127.0.0.1:55432`（db: `booth`, user: `booth`） |
| Redis | `127.0.0.1:56379` |
| Silo S3 API | `http://localhost:19000`（bucket: `booth-assets`） |
| Silo Web Console | `http://localhost:19001` |

---

## 常用命令

### Docker 级别（完整验证）

```powershell
# 类型检查 + 测试 + 构建（容器内跑）
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm check

# 端到端冒烟测试
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm smoke

# 手动跑数据库迁移 / S3 初始化
docker compose --env-file .env -f infra/compose.dev.yaml run --rm migrate
docker compose --env-file .env -f infra/compose.dev.yaml run --rm storage-init

# 停止（保留 volume 数据）
docker compose --env-file .env -f infra/compose.dev.yaml down
```

### 后端 `apps/server`（包管理器：npm）

```powershell
cd apps/server
npm run dev:api       # 启动 API（watch 模式）
npm run dev:worker    # 启动 BullMQ Worker（watch 模式）
npm run check         # 类型检查（源码 + 测试）
npm run build         # 构建
npm test              # 全量测试
npx tsx --test tests/app.test.ts  # 跑单个测试文件
npm run migrate       # 手动跑迁移（需 DB 已启动）
npm run smoke         # 冒烟测试（需全部服务运行）
```

### 前端 `apps/client`（包管理器：pnpm）

```powershell
cd apps/client
pnpm dev          # 开发服务器
pnpm build        # 类型检查 + 生产构建
pnpm preview      # 预览构建产物
```

### 管理后台 `apps/admin`（包管理器：pnpm ≥ 11，Turborepo）

```powershell
cd apps/admin
pnpm install
pnpm dev           # 全部子包
pnpm dev:antd      # 仅 Ant Design 子包
pnpm check:type    # 类型检查（Turbo）
pnpm check         # 全量检查（循环依赖 + 类型 + cspell）
pnpm lint
pnpm format
pnpm test:unit
pnpm vitest run <path/to/test.ts>  # 跑单个测试
```

---

## 架构关键点

### 后端双进程

- `src/api.ts` → HTTP API Server（Fastify，薄 controller，业务在 service 层）
- `src/worker.ts` → BullMQ Worker + Transactional Outbox 轮询分发器（每秒轮询，批量 10 条）

### 后端源码结构

```
src/
├── api.ts / worker.ts    # 两个独立进程入口
├── app.ts                # Fastify 工厂（插件、CORS、Helmet、Swagger、错误处理、健康路由）
├── config.ts             # 环境变量解析与校验（失败时进程退出，不回显 secret 值）
├── infra/                # 基础设施适配层
│   ├── database.ts       # pg.Pool + transaction() 辅助函数
│   ├── redis.ts          # ioredis（worker role: maxRetriesPerRequest=null；request role: 快速失败）
│   ├── storage.ts        # S3 双端点客户端 + presigned URL 生成
│   └── queue.ts          # BullMQ 队列定义（booth-foundation）
├── modules/              # 业务模块（admin / client / su / tasks）
│   └── tasks/
│       ├── service.ts    # Foundation echo 任务提交 + 幂等处理
│       └── outbox.ts     # Outbox 轮询分发器
└── scripts/              # 独立运维脚本
    ├── migrate.ts        # 迁移执行器（Postgres advisory lock 19002401）
    ├── storage-init.ts   # S3 bucket 初始化（含指数退避重试）
    └── smoke.ts          # E2E 冒烟（需全部服务在线）
```

### TypeScript / ESM 注意事项

- 后端是纯 ESM（`"type": "module"`，`module: NodeNext`）。
- **所有内部相对导入必须带 `.js` 扩展名**（如 `import { buildApp } from './app.js'`），即使源文件是 `.ts`。
- 两套 tsconfig：
  - `tsconfig.json`：`rootDir=src`，输出到 `dist/`（`npm run build`）。
  - `tsconfig.test.json`：`rootDir=.`，同时覆盖 `src/` 和 `tests/`，只做类型检查不产出文件（`npm run check` 会同时执行两套）。
- `noUncheckedIndexedAccess: true`，数组/对象下标访问返回 `T | undefined`。

### 测试

- 使用 **Node 原生测试运行器**（`node:test` + `node:assert/strict`），以 `tsx --test` 执行。
- `tests/app.test.ts`：用 `fastify.inject()` 做路由测试，**不需要外部服务**，可本地直接跑。
- `src/scripts/smoke.ts`（`npm run smoke`）：需要 Postgres、Redis、Silo S3 全部在线。
- 单文件跑法：`npx tsx --test tests/app.test.ts`

### 数据库迁移

- 迁移文件在 `apps/server/migrations/*.sql`，带 SHA-256 校验和，已执行的**禁止修改**，只能新增。
- 文件名格式必须匹配 `^\d+_.+\.sql$`（按字母序执行）。
- 迁移脚本：`src/scripts/migrate.ts`（获取 Postgres advisory lock 后原子执行）。

### 事务性 Outbox 模式

- Task 入库和 Outbox 事件写入必须在**同一数据库事务**中完成。
- Outbox 分发用 `SELECT ... FOR UPDATE SKIP LOCKED` + 确定性 `jobId`（= taskId）保证幂等。
- 调用第三方 AI API 期间**不能持有数据库锁**。
- Worker 健康检查：成功迭代后写 `/tmp/worker-ready`；Redis 断连或分发失败时清除该文件。

### S3 双端点

- `S3_ENDPOINT`（`http://silo:9000`）：容器内部调用。
- `S3_PUBLIC_ENDPOINT`（`http://localhost:19000`）：生成 presigned URL 给浏览器用。
- **禁止把容器内部 hostname 暴露给前端**。

### 环境变量（必填项）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL URI（`postgres://` 或 `postgresql://`） |
| `REDIS_URL` | Redis URI（`redis://` 或 `rediss://`） |
| `CORS_ORIGINS` | 逗号分隔的允许来源（如 `http://localhost:5173`） |
| `S3_ENDPOINT` | S3 内部端点 |
| `S3_PUBLIC_ENDPOINT` | S3 公开端点（presigned URL 专用） |
| `S3_REGION` | 默认 `us-east-1` |
| `S3_BUCKET` | Bucket 名称 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3 凭据 |

可选：`NODE_ENV`（默认 `development`）、`HOST`（默认 `0.0.0.0`）、`PORT`（默认 `3000`）、`LOG_LEVEL`（默认 `info`）。

---

## 安全约束

- 禁止在日志或错误响应中输出任何凭据或 secret（`config.ts` 校验失败只报字段名，不回显值）。
- Fastify 已关闭请求日志（`disableRequestLogging: true`），headers 中 `authorization`/`cookie` 已脱敏。
- 错误响应只返回标准化 code：`VALIDATION_ERROR` / `REQUEST_ERROR` / `INTERNAL_ERROR`。

---

## 代码约定

- **后端**：Controller 保持薄，业务逻辑放 service/repository 层。
- **不写向后兼容 shim**：废弃接口直接删除（数据库 schema 变更除外，需迁移）。
- 修改 `infra/`、`modules/`、`scripts/` 等核心逻辑时，必须同步更新或新增测试。
- 非平凡逻辑改动后，必须跑 `npm run check`（后端）或 `pnpm build`（前端）验证类型正确。

---

## PowerShell 注意事项

- PowerShell 里反引号 `` ` `` 是转义字符，包含 backtick 的多行文本（commit message、PR description 等）**必须写入临时文件**再传给命令，不能直接拼接在命令行字符串里：
  ```powershell
  # 先写文件
  # Write 工具写到 C:\Users\...\AppData\Local\Temp\opencode\msg.txt
  git commit -F "C:\Users\...\AppData\Local\Temp\opencode\msg.txt"
  gh pr create --body-file "..."
  ```

---

## 认证体系

- 与灵通企业已有用户系统对接（外部 SSO）。
- 本地维护两张同步表：`users`（参展商/SU）和 `admins`（管理端），不自建完整用户体系。
