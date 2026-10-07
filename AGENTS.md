# AGENTS.md — 灵通 AI 展台方案平台

AI 驱动的展台方案选型与成交平台，核心链路：描述需求 → AI 匹配方案 → 品牌调整 → 物料清单 → 询价交接。

双门户：参展商公众端（`apps/client`）+ 合作伙伴/管理端（`apps/admin`），共用后端 `apps/server`。

本文件只放**跨子项目共享**的信息；各子项目的命令、结构与约定见其自己的 `AGENTS.md`，进入对应目录工作前必须先读。

---

## 子项目索引

| 目录 | 说明 | 包管理器 | 专属文档 |
|------|------|----------|----------|
| `apps/server` | Fastify 5 API + BullMQ Worker（Node 24, TS ESM） | npm | [`apps/server/AGENTS.md`](apps/server/AGENTS.md) |
| `apps/client` | 参展商前端：Vue 3.5 + Vite 6 + Tailwind 3 + Shadcn-Vue | pnpm | [`apps/client/AGENTS.md`](apps/client/AGENTS.md) |
| `apps/admin` | 管理后台：Vben Admin 5 + Ant Design Vue 4（pnpm + Turborepo monorepo） | pnpm ≥ 11 | [`apps/admin/AGENTS.md`](apps/admin/AGENTS.md) |

`apps/shadcn-vue-admin-main` 是外部模板，不属于业务链路，无需关注。

其他目录：`infra/`（Docker Compose：Postgres 17、Redis 7.4、Silo S3）、`scripts/setup.ps1`（一键初始化）、`docs/`（PRD、架构说明、一期 API 文档）、`lefthook.yml` + `commitlint.config.mjs`（Git hooks：提交前 lint、提交信息校验、推送前按改动范围执行各子项目检查）。

每个 `apps/*` 是独立包，**命令必须在对应子目录执行，不要在根目录混用**。

---

## 环境与基础设施

```powershell
./scripts/setup.ps1             # 生成 .env（含随机密码）、构建镜像、启动 DB/Redis/Silo、跑 migrate、启动 api/worker
./scripts/setup.ps1 -SkipStart  # 只生成 .env

docker compose --env-file .env -f infra/compose.dev.yaml up -d --build                 # 重建并启动 dev 栈
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm check  # 容器内类型检查 + 重建 booth_test 跑全部测试（含集成测试）+ 构建
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm smoke  # 端到端冒烟
docker compose --env-file .env -f infra/compose.dev.yaml run --rm migrate               # 手动跑迁移
docker compose --env-file .env -f infra/compose.dev.yaml run --rm storage-init          # S3 初始化
docker compose --env-file .env -f infra/compose.dev.yaml down                           # 停止（保留 volume）
```

`.env` 在根目录，**永远不要提交**。服务端环境变量清单见 `apps/server/AGENTS.md`。

| 服务 | 地址 |
|------|------|
| API | `http://localhost:3000`（Swagger: `/docs`） |
| client 开发服务器 | `http://localhost:5173` |
| admin 开发服务器（web-antd） | `http://localhost:5666` |
| PostgreSQL | `127.0.0.1:55432`（db: `booth`, user: `booth`） |
| Redis | `127.0.0.1:56379` |
| Silo S3 API / Web Console | `http://localhost:19000` / `http://localhost:19001`（bucket: `booth-assets`） |

---

## 前后端契约（跨项目联动点）

改动以下任一处时，需同步检查另一端：

- **路由前缀**：参展商接口 `/api/v1/client/*`、管理端接口 `/api/v1/admin/*`，SU 接口在 `apps/server/src/http/su/`。
- **开发代理**：client 与 admin 的 Vite 都把 `/api` 代理到 `http://localhost:3000`；后端 dev 栈 `CORS_ORIGINS` 默认放行 `5173`/`5174`。
- **响应包装**：业务接口成功返回 `{ code: 0, data }`（admin `requestClient` 依赖此格式拦截）；错误统一为 `{ error: { code, message, requestId } }`，code 只有 `VALIDATION_ERROR` / `REQUEST_ERROR` / `INTERNAL_ERROR`。
- **认证**：对接灵通企业已有用户系统（外部 SSO），本地只维护 `users`（参展商/SU）与 `admins`（管理端）两张同步表；登录后前端以 `Authorization: Bearer <token>` 访问。实现入口见 `apps/server/AGENTS.md` 的“关键架构入口”。
- **文件访问**：前端拿到的只能是基于 `S3_PUBLIC_ENDPOINT` 的 presigned URL，**禁止把容器内部 hostname 暴露给前端**。
- **接口文档**：以运行中的 Swagger（`/docs`、`/openapi.json`）为准，一期需求与 API 拆分在 `docs/一期功能拆分/`。

---

## 全局约定

- 提交信息遵循 Conventional Commits。
- **不写向后兼容 shim**：废弃接口直接删除（数据库 schema 变更除外，需迁移）。
- 修改核心逻辑必须同步更新或新增测试；非平凡改动后必须跑对应子项目的类型检查和测试（client：`pnpm build` + `pnpm test`；admin：`typecheck` + `pnpm test:antd`；server：`check` 服务，命令见子项目文档）。Git hooks 统一在根目录 `lefthook.yml`：提交前对 admin 暂存文件做 lint 与类型检查，commit-msg 按根目录 `commitlint.config.mjs` 校验提交信息，推送前按改动范围执行上述检查；`LEFTHOOK=0` 可临时跳过，但跳过时需说明原因。GitHub Actions（`.github/workflows/ci.yml`）在 PR 与推送 `main` 时对三个子项目执行同样的检查，server 额外跑 `smoke`；改动任一子项目的检查命令时，需同步该子项目 `AGENTS.md`、`lefthook.yml` 与 CI。
- 安全：禁止在日志或错误响应中输出凭据或 secret。

### PowerShell

PowerShell 里反引号 `` ` `` 是转义字符，包含反引号的多行文本（commit message、PR description 等）**必须写入临时文件**再用 `git commit -F <file>` / `gh pr create --body-file <file>` 传入，不能直接拼在命令行里。
