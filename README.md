# 灵通 AI 展台方案平台

> AI 驱动的展台方案选型与成交平台，核心链路：**描述需求 → AI 匹配方案 → 品牌调整 → 物料清单 → 询价交接**

双门户：参展商公众端 + 合作伙伴/管理端

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 API | Fastify 5 + TypeScript ESM（Node 24） |
| 异步任务 | BullMQ 6 Worker + Transactional Outbox |
| 数据库 | PostgreSQL 17 |
| 缓存队列 | Redis 7.4 |
| 对象存储 | Silo（S3 兼容） |
| 参展商前端 | Vue 3.5 + Vite 6 + Tailwind CSS 3 |
| 管理后台 | Vben Admin 5 + Ant Design Vue 4（Turborepo） |

---

## 仓库结构

```
booth-ai/
├── infra/                  # Docker Compose 开发环境
├── scripts/setup.ps1       # 一键初始化环境 + 启动
├── docs/                   # PRD、架构说明、API 文档
├── apps/
│   ├── server/             # 后端：Fastify API + BullMQ Worker
│   ├── client/             # 参展商前端（Vue 3）
│   └── admin/              # 管理后台（Vben Admin）
└── lefthook.yml            # Git hooks
```

每个 `apps/*` 是独立包，**不要在根目录混用各子项目的命令**。

---

## 快速开始

### 前置条件

- Docker & Docker Compose
- Node.js 24+
- PowerShell 7+

### 一键初始化

```powershell
# 生成 .env、构建镜像、启动所有服务、跑 migrate
./scripts/setup.ps1

# 仅生成 .env，不启动容器
./scripts/setup.ps1 -SkipStart
```

### 本地服务地址

| 服务 | 地址 |
|------|------|
| API | http://localhost:3000（Swagger: `/docs`） |
| PostgreSQL | 127.0.0.1:55432（db: `booth`，user: `booth`） |
| Redis | 127.0.0.1:56379 |
| Silo S3 API | http://localhost:19000（bucket: `booth-assets`） |
| Silo Web Console | http://localhost:19001 |

`.env` 在根目录，**永远不要提交到 Git**。

---

## 常用命令

### Docker 级别（推荐用于 CI / 完整验证）

```powershell
# 类型检查 + 测试 + 构建
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm check

# 端到端冒烟测试
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm smoke

# 手动跑迁移 / S3 初始化
docker compose --env-file .env -f infra/compose.dev.yaml run --rm migrate
docker compose --env-file .env -f infra/compose.dev.yaml run --rm storage-init

# 停止（保留 volume 数据）
docker compose --env-file .env -f infra/compose.dev.yaml down
```

### 后端 `apps/server`（npm）

```powershell
cd apps/server
npm run dev:api       # 启动 API（watch 模式）
npm run dev:worker    # 启动 BullMQ Worker（watch 模式）
npm run check         # 类型检查
npm test              # 全量测试
npm run migrate       # 手动跑数据库迁移
npm run smoke         # 冒烟测试（需全部服务运行）
```

### 参展商前端 `apps/client`（pnpm）

```powershell
cd apps/client
pnpm dev              # 开发服务器
pnpm build            # 类型检查 + 生产构建
pnpm preview          # 预览构建产物
```

### 管理后台 `apps/admin`（pnpm ≥ 11，Turborepo）

```powershell
cd apps/admin
pnpm install
pnpm dev              # 全部子包
pnpm dev:antd         # 仅 Ant Design 子包
pnpm check:type       # 类型检查
pnpm check            # 全量检查（循环依赖 + 类型 + cspell）
pnpm test:unit        # 单元测试
```

---

## 架构说明

### 后端双进程

- **`src/api.ts`** — HTTP API Server（Fastify，薄 controller，业务在 service 层）
- **`src/worker.ts`** — BullMQ Worker + Transactional Outbox 轮询分发器

### 事务性 Outbox 模式

Task 入库与 Outbox 事件写入在**同一数据库事务**中完成，Outbox 分发使用 `FOR UPDATE SKIP LOCKED` + 确定性 `jobId` 保证幂等。调用第三方 AI API 期间不持有数据库锁。

### S3 双端点

- `S3_ENDPOINT`（`http://silo:9000`）— 容器内部调用
- `S3_PUBLIC_ENDPOINT`（`http://localhost:19000`）— 生成 presigned URL 供浏览器访问

禁止将容器内部 hostname 暴露给前端。

### 数据库迁移

迁移文件在 `apps/server/migrations/*.sql`，带校验和。**已执行的迁移文件禁止修改**，只能新增。

---

## 认证体系

与灵通企业已有用户系统对接（外部 SSO）。本地维护两张同步表：`users`（参展商）和 `admins`（管理端），不自建完整用户体系。

---

## 文档

详细需求与架构文档见 [`docs/`](./docs/) 目录。
