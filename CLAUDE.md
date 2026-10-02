# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## 关键架构文档

深入修改前建议先读对应文档：

- `docs/server-module-boundaries.md` — 模块职责与依赖规则（`tests/module-boundaries.test.ts` 用 AST 静态检查强制执行，反向依赖会导致测试失败）
- `docs/server-authentication.md` — 认证体系：`http/authentication.ts` 统一建立请求级 principal，`modules/identity/principal.ts` 校验账户与 Session 版本
- `docs/credit-invariants.md` — 积分账本不变量（预占、结算、对账）
- `docs/theme-outbox-recovery.md` — 生成任务 Outbox 恢复机制
- `docs/asset-scope.md` — 方案基线资产与用户生成素材的作用域隔离
- `docs/worker-observability.md` — Worker 调度隔离、健康状态、指标、链路追踪与项目通知投递

## 易错点速记

- 后端内部相对导入必须带 `.js` 扩展名（纯 ESM，`module: NodeNext`）。
- `noUncheckedIndexedAccess: true` — 数组/对象下标访问返回 `T | undefined`。
- 两套 tsconfig：`tsconfig.json`（build，rootDir=src）与 `tsconfig.test.json`（check，覆盖 src+tests，不产出文件）；`npm run check` 会同时执行两套。
- 测试用 Node 原生 test runner：单文件跑 `npx tsx --test tests/app.test.ts`；`tests/app.test.ts` 用 `fastify.inject()`，无需外部服务。
- `*-integration.test.ts` 及部分 DB 测试在对应环境变量缺失时会 `skip`（`npm test` 与 Docker `check` 默认都不设置），测试通过不代表它们跑过。按需设置：`PROJECT_` / `THEME_` / `CREDIT_` / `ARTWORK_` / `ASSET_` / `BOM_` / `PROMPT_TEMPLATE_` + `TEST_DATABASE_URL`，以及 `THEME_TEST_REDIS_URL`。
- 迁移文件带 SHA-256 校验和，已执行的禁止修改，只能新增；文件名须匹配 `^\d+_.+\.sql$`。
- `src/modules/{admin,client,su}/` 只剩重构遗留的空目录，不要往里放代码；按业务领域放入对应模块。
- PowerShell 中含反引号的多行文本（commit message 等）必须写入临时文件再用 `-F`/`--body-file` 传入。
- **改完 `apps/server`（代码或迁移）必须重新部署 dev 栈，无需询问**：`docker compose --env-file .env -f infra/compose.dev.yaml up -d --build`，然后验证 `schema_migrations` 最新版本、`curl localhost:3000/health/ready`、worker `/tmp/worker-status.json` 与日志，并汇报结果。原因：`src`/`migrations` 虽以只读方式挂载并由 `tsx watch` 运行，但 Windows bind mount 下文件变更事件不可靠、热重载常不生效；新迁移只在 `migrate` 服务重跑时执行；依赖/Dockerfile 变更必须重建镜像。仅改测试或文档时可跳过，但需说明。
