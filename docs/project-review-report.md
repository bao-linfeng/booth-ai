# 项目审查待办清单

> 来源：2026-10-19 项目审查报告，已逐条对照代码与运行环境核查。
> 本清单只保留核查属实、仍需处理的事项；已过时或收益过低的建议列在文末。

---

## P1 — 数据正确性，优先修复

### 1. 方案编号重复 URL 解码（server）

- **现状**：Fastify 已解码路由参数，以下 4 处又调用一次 `decodeURIComponent`。实测 `A%2541` → Fastify 得到 `A%41` → 再解码为 `AA`，命中错误方案；`A%25B` 再解码抛错返回 400。方案编号只限制 `maxLength: 200`，无字符约束，可能误读、误改、误删方案。
  - `apps/server/src/http/admin/schemes/index.ts`（`decodedCode`）
  - `apps/server/src/http/admin/reviews/index.ts`（`decodedCode`）
  - `apps/server/src/http/admin/assets/index.ts`（`decodedCode`）
  - `apps/server/src/http/admin/bill-of-materials/index.ts`（`decode`）
- [x] 删除上述 4 处重复解码，直接使用 `request.params`
- [x] 评估方案编号字符白名单：暂不加。dev 库 48 条方案中已有 `TW66_BK_044_F&B` 含 `&`，严格白名单会拒绝现有编号；去掉重复解码后任意字符都能正确往返，如需约束需先与业务确认编号规则
- [x] 增加路由测试 `apps/server/tests/http/admin-scheme-code-params.test.ts`：`A%41`、`A%B`、`100%`、中文加空格、`/`，覆盖 4 组路由，且 `A%2541` 不得命中 `AA`（修复前该测试失败）

### 2. 外部语言接口 401 误清除本平台登录态（client）

- **现状**：`apps/client/src/services/api/language.ts` 使用 `lingtongFetch`，会注入本平台 token，且 401 时调用 `handleUnauthorized()` 清除登录态并跳转登录页。实测 `https://api.lingtong.net.cn/api/language/list` 无 token 返回 200，带本平台 token 返回 401。
- **触发条件**：`LanguageToggle.vue` 在组件 setup 时请求（非打开菜单时），且仅在 localStorage `app-language-list` 为空时请求，即“已登录 + 语言缓存为空”。
- [x] `getLanguageList()` 改用 `lingtongPublicFetch`，不再携带本平台 token
- [x] `lingtongFetch` 已无其他调用方，已删除；同步 `apps/client/AGENTS.md` 的后端对接说明
- [x] 增加回归测试 `apps/client/tests/language-list.test.mjs`：加载真实 `api-client` 与 ofetch，已登录时请求不带 `Authorization`，外部接口 401 不清除登录态、不跳转登录页（修复前 2 条均失败）

---

## P2 — 边界与幂等

### 3. 审核 requestKey 可跨方案、跨内容重放（server）

- **现状**：`apps/server/migrations/008_reviews.sql` 中 `request_key text NOT NULL UNIQUE` 为全局唯一，后续迁移未修改；`apps/server/src/modules/schemes/reviews.ts` 的 `createReview` 先按 key 查旧记录直接返回，且早于版本校验，不比对 `scheme_id`、`phase`、`scheme_revision`、`decision`、`checks`、`notes`。
- [x] ~~新增迁移，唯一约束改为 `(scheme_id, request_key)`~~：改为与 BOM 复核（`bill-of-materials/verification.ts`）一致，保留全局唯一，跨方案复用 key 直接 409，无需迁移
- [x] 重放时比对 `scheme_id`、`scheme_revision`、`phase`、`decision`、`checks`（jsonb，与键顺序无关）、`notes`，不一致返回 409 `IDEMPOTENCY_CONFLICT`；并发插入落到 `ON CONFLICT` 分支时同样比对
- [x] 管理端：`IDEMPOTENCY_CONFLICT` 提示改为通用文案（原为客服“消息”专用）；审核弹窗遇到该 reason 时关闭并刷新状态，不再误报“方案已被修改”
- [x] 增加测试：`tests/integration/scheme-reviews-integration.test.ts`（跨方案同 key、同方案同 key 不同 payload、键顺序不同仍重放、方案修改后原样重放，修复前失败）；`tests/unit/reviews.test.ts` 补冲突用例

### 4. 智选检索可关联其他访客的 parseId（server）

- **现状**：`apps/server/src/modules/selection/service.ts` 仅判断 `attemptId === input.attemptId`，未校验 `parseId` 归属；`recordSearch` 直接写入。`apps/server/src/http/errors.ts` 未映射 PostgreSQL `23503`，传入不存在的 parse UUID 会返回 500。
- [x] `recordSearch` 写入时以子查询限定 parse 属于本次 attempt（attempt 已由 `ensureAttempt` 限定为当前访客），否则记为 null；同时涵盖原先“尝试重建时丢弃旧 parseId”的逻辑，`service.ts` 不再单独判断
- [x] ~~校验失败返回明确的 400/409~~：改为静默不关联。该关联只用于统计分析，用户无从处理，不应让检索失败；与原有尝试重建时的处理一致。不存在的 parse UUID 也不再触发 23503 返回 500（dev 实测返回 200，`parse_id` 为 NULL）
- [x] 增加集成测试（`selection-parse-attempts-integration.test.ts`）：本尝试的 parse 正常关联，跨访客 parseId、不存在的 parse UUID 记为 null（修复前失败）

### 5. Compose 未向 api/worker 传递项目通知 Webhook 变量（infra）

- **现状**：`infra/compose.dev.yaml` 的 `x-server.environment` 缺少 Webhook 变量；`apps/server/src/worker.ts` 仅在 `config.projectNotificationWebhook` 存在时启动投递。实测 worker 容器内无该变量，日志提示 `Project notification channel not configured; events stay pending in project_notification_outbox`，outbox 有 1 条 pending（约 6.8 天）。当前根目录 `.env` 也未配置这两个变量，属于潜在问题。
- [x] `x-server.environment` 补充：
  ```yaml
  PROJECT_NOTIFICATION_WEBHOOK_URL: ${PROJECT_NOTIFICATION_WEBHOOK_URL:-}
  PROJECT_NOTIFICATION_WEBHOOK_SECRET: ${PROJECT_NOTIFICATION_WEBHOOK_SECRET:-}
  ```
- [x] 同步 `apps/server/AGENTS.md` 环境变量说明（补充 secret ≥ 32 字节、配置错误时进程启动失败）；`.env.example` 补充两项及说明
- [x] 重新部署 dev 栈并验证：`compose config` 设置变量后 api/worker 均可拿到；未配置时容器内为空值，worker 健康且日志仍提示未配置渠道
- [ ] 如需实际投递，在根目录 `.env` 配置真实 URL 与 secret 后重新部署（outbox 中积压的 pending 通知届时会被投递）

---

## P3 — 工程小项

- [x] `apps/client/src/composables/useFont.ts`：调用前判断 `document.fonts?.load` 是否存在，不存在时跳过预加载，仍设置字体变量
- [x] `i18n-t` warning 仍存在（40 条，来自 `ai-selection`、`selection-quote-flow`）：mock 只在 `createI18n()` 插件里注册 `i18n-t`，这两个测试未安装插件。已改为 `app.use(createI18n())`，与真实应用一致，warning 清零
- [x] CI client 任务改读 `apps/client/.node-version`（新增，24.16.0）与 `apps/client/package.json` 的 `packageManager`（新增，pnpm@11.16.0，与 CI 原先实际使用的版本相同）；`apps/client/AGENTS.md` 已补充说明。`lefthook.yml` 只在本机执行命令、不指定版本，无需改动
- [x] 4 条重复导入 warning：动态导入原本只为避开循环引用，且被导入模块本就在主 chunk，不起拆包作用。`api-client` 改为静态导入 router、auth store、pinia，auth store 改为静态导入客服模块；双方只在函数内使用对方，求值顺序不影响。构建 warning 清零，`language-list` 测试的 router 替身改为调用时读取
- [x] 全局 CSS 复核属实（1,161 kB / gzip 135 kB）：`tailwind.config.js` 的 safelist 按 11 种颜色 × 全部色阶 × 透明度 × 6 种变体生成约 1.86 万条规则，而唯一的动态类名是外观设置里 6 个色块的 `bg-{color}-500`。已删除 safelist，色块改为完整类名映射；CSS 降至 73 kB / gzip 12.7 kB，对比前后选择器，删除的均为 safelist 生成的颜色类、无其他类丢失

---

## 待产品决策（先定规则，再改代码）

- [ ] **16:9 校验**：目前在 `modules/assets/upload.ts`、`modules/schemes/readiness.ts`、`modules/selection/repository.ts` 及管理端 `views/assets/renderings/` 上传与就绪页面中均被注释关闭。决定恢复、改为可配置容差，还是正式定为不校验。
- [ ] **四向素材 `mappingStatus: 'unresolved'`**：在 `generation/artwork/directions.ts`、`generation/artwork/queries.ts`、`generation/queries.ts`、`projects/artwork-delivery.ts`、`projects/snapshot.ts` 中写死。确认一期是否只作设计参考；若用于制作，需规划墙面/物料映射、尺寸复核、人工确认与重新生成替换流程。
- [ ] **跟进提醒**：已有 `nextFollowUpAt` 与今日/逾期查询，但 Worker 无定时提醒任务。确认是否需要提醒承接人，以及改派、终态项目的提醒规则。
- [ ] **项目通知重投**：`/project-notifications` 只有列表、详情、已读、全部已读，无人工重投接口。确认是否需要。
- [ ] **通知收件范围**：收件箱目前全员可见，仅已读状态按管理员区分。确认全员 / 承接人 / 主管 / 按组织隔离。
- [ ] **outbox pending 告警**：未配置 Webhook 时 pending 属正常现象，接入告警前需区分该情况，避免误报。

---

## 后续排期

- [ ] SU 专用 API：`http/su/`（S1 身份同步、S1 当前用户与积分、S2 导出）与 `http/admin/su-exports/`（B4 复核），目前均为单行占位注释、未注册路由
- [ ] 伙伴项目接口：`http/client/partner/index.ts`（A6），单行占位
- [ ] 运维告警：Outbox 最老待处理时间、通知失败数、积分对账异常数、生成任务超期数、Worker 连续失败与 stale、邮件/翻译 dead letter
- [ ] 数据库性能：按真实数据量对候选池、`asset_versions`、`scheme_reviews`、`selection_searches` 分页及项目 JSONB 搜索执行 `EXPLAIN ANALYZE`，按需加复合索引
- [ ] 真实环境验收：灵通 SSO、AI 供应商请求与超时、SMTP、Webhook 外部投递、生产反向代理 / HTTPS / 跨域 / 多副本

---

## 无需处理

| 原建议 | 原因 |
|---|---|
| 拆分 `QuoteRequest.vue` | 已拆分：页面仅 97 行，表单、草稿、上下文、提交、回执已在 `features/quote-request/` 下独立 |
| 拆分 `useSelectionFlow.ts` | 已基本拆分：仅 258 行，会话与图片已独立为 `useSelectionSession.ts`、`useSchemeImages.ts` |
| 生产注入随机 `VITE_APP_STORE_SECURE_KEY` | 该 key 会打包进前端 JS，只是本地存储混淆而非真正的密钥，收益很低 |
