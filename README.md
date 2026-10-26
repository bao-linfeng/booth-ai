# 灵通 AI 展台方案平台

AI 驱动的展台方案选型与询价交接平台，面向参展商提供公众端，面向合作伙伴和运营人员提供管理端，共用后端 API 与异步 Worker。

核心链路：**描述需求 → AI 智选 → 查看方案 → 品牌主题调整 → 四面素材与资料下载 → 申请报价 → 项目承接与跟进**。没有匹配方案时，可提交人工需求进入项目承接流程；全程可通过自研在线客服与坐席实时沟通（支持多语言自动翻译）。

本 README 按当前源码中的页面、已注册路由、包脚本和 Compose 配置整理。接口字段与约束以服务端路由 Schema 和运行中的 OpenAPI 为准；需求文档用于补充业务背景。

## 项目概览

| 维度 | 说明 |
| --- | --- |
| 项目类型 | B2B 全栈 SaaS：AI 展台方案选型 + AIGC 品牌素材生成 + 询价成交与客服 |
| 门户 | 参展商公众端（12 种语言、RTL）+ 合作伙伴 / 运营管理后台，共用一套 API 与异步 Worker |
| 后端规模 | Fastify 5 + TypeScript，约 2.9 万行源码；80 个顺序 SQL 迁移；约 450 个测试用例（单元 / HTTP / 集成 / 架构约束） |
| AI 能力 | 自然语言需求解析（LLM + 规则降级）、品牌主题图生成、四面素材生成、客服消息翻译；接入 OpenAI 兼容、Gemini、通义 Qwen-Image / 万相、火山方舟 Seedream 等多家协议，按用途配置主备模型 |
| 工程化 | Docker Compose 一键开发栈、Lefthook + commitlint、oxlint / oxfmt、GitHub Actions 三端 CI（类型检查、测试、构建、端到端冒烟） |

### 技术亮点

- **可靠异步任务链路**：生成任务与 Outbox 在同一事务写入，Worker 轮询分发到 BullMQ；确定性 jobId 去重、租约（lease）+ 心跳防重复执行、失败恢复与对账任务兜底，调用 AI / 外部服务时不持有数据库锁。
- **积分账本**：生成前预占、成功结算、失败释放，带幂等键与数据库约束保证余额与流水一致，并有对账与问题单（generation credit issues）机制。
- **多供应商 AI 适配层**：统一协议抽象（文本解析 / 图像生成 / 翻译），按用途（`selection_parse`、`theme`、`artwork`、`cs_translation`）分配模型、主备切换与积分定价；供应商凭据以 AES-256-GCM 加密存储，提示词模板可在后台版本化维护与预览。
- **自研在线客服**：访客 / 登录用户携带方案或项目上下文发起咨询，公共队列 + 坐席抢接 / 转接；基于 Redis Pub/Sub + SSE 的实时推送（一次性 ticket 鉴权、心跳复核会话与权限、断线降级轮询）；AI 双向翻译、离线留言邮件、回复提醒、6 个月消息保留策略与坐席失效巡检。
- **类型安全的 API 契约**：路由基于 JSON Schema + `json-schema-to-ts` Type Provider 同时生成请求 / 响应类型与 OpenAPI；自研响应守卫比对序列化前后数据，测试环境直接暴露 schema 漂移，生产环境自动兜底；统一错误契约（`code` / `reason` / `details`），前端按 `reason` 映射提示。
- **细粒度权限**：同步外部 SSO 角色，在本地配置页面与操作权限（多角色取并集），菜单、路由、按钮与服务端接口逐请求统一校验；客户端与管理端会话隔离、会话版本号支持强制失效。
- **安全与稳定性**：基于 Redis + Lua 原子计数的固定窗口限流（按 IP / 用户 / 访客维度覆盖登录、生成、询价、客服消息等）、Helmet、日志脱敏（Authorization / Cookie / 收件人邮箱）、presigned URL 双端点隔离、上传幂等与版本化修改（`expectedRevision`）防并发覆盖。
- **国际化**：客户端 12 种语言（含阿拉伯语 RTL 布局），选型字典与服务端提示文案按 `Accept-Language` 多语言返回，邮件文案同样支持 12 种语言。

## 现有功能

### 参展商公众端

| 功能 | 当前能力 | 页面入口 |
| --- | --- | --- |
| AI 智选 | 自然语言解析需求、确认结构化条件、匹配已审核公开方案；模型解析失败时规则降级 | `/`、`/ai-selection` |
| 方案详情 | 查看规格、效果图、资料状态及适用条件 | `/schemes/:code` |
| 品牌主题调整 | 选择模型、确认积分费用、提交生成任务、查看进度与结果、选定主题结果 | `/schemes/:code/theme`、`/theme-jobs/:jobId` |
| 四面素材生成 | 基于选定主题生成四个方向的素材，查看任务与交付状态、单图及 ZIP 下载 | `/schemes/:code/artwork`、`/artwork-jobs/:jobId` |
| 方案资料 | 查看已核验简化清单、导出 Excel；查看和下载报馆图、平面素材及模型文件 | 方案详情页 |
| 申请报价 | 填写展会、联系方式和服务范围，生成询价与项目记录 | `/schemes/:code/quote` |
| 人工需求 | 提交未匹配需求、已确认条件和待解决问题，进入项目承接 | `/manual-request` |
| 多语言与 RTL | 支持 12 种语言（中、英、法、德、日、俄、意、西、阿、印地、葡、马来）；切换至阿拉伯语时自动应用 RTL 布局 | 全局导航栏语言切换 |
| 我的记录 | 历史检索及关联生成结果（登录用户按账号、访客按浏览器身份读取）、项目列表与详情、生成素材关联项目 | `/my-searches`、`/my-projects`、`/my-projects/:projectId` |
| 账号与积分 | 灵通账号登录、外部 token 同步、个人信息、积分余额与每日签到（签到入口在导航栏用户菜单） | `/auth/sign-in`、`/profile` |
| 在线客服 | 访客或登录用户发起咨询，可附带当前方案 / 项目卡片；实时收发与自动翻译、未读角标、坐席离线时留言（留邮箱）；登录后访客会话自动合并；匿名提交的项目按验证邮箱认领 | 全局悬浮按钮、方案详情、报价回执、我的项目 |

`/ai-selection/preview` 及其方案详情、主题调整子路由提供静态预览。真实生成依赖登录、可用积分、AI 模型配置及方案源素材。

### 合作伙伴 / 管理端

| 模块 | 当前能力 |
| --- | --- |
| 工作台 / 分析页 | 个人待办（逾期、今日、待跟进项目）与最近动态；按 7 / 30 / 90 天窗口统计检索、生成、项目漏斗与分布，按模块权限裁剪分区 |
| 方案管理 | 列表、创建与编辑、批量导入预览及确认、适用条件、审核就绪检查、审核、发布与下架；仅修改内部备注（notes）不触发下架与版本重置 |
| 资源管理 | 效果图、蒙版、报馆图、平面素材；上传、元数据维护、版本替换、预览与下载 |
| 清单管理 | Excel 导入、预览与确认、条目维护、版本校验、核验与下载 |
| AI 智选运营 | 检索记录、访客信息、趋势与统计 |
| 生成任务 | 主题 / 四面素材任务查询、详情及结果查看 |
| 项目承接 | 项目检索、承接人改派、跟进、方案关联、事件记录、报价版本编辑与 Excel 导出 |
| 消息通知 | 项目通知收件箱、详情、单条及全部标记已读；可选 webhook 投递，询价回执邮件 |
| 在线客服 | 客服工作台：公共队列抢接、释放、转接、结束、内部备注、在线状态、实时消息与译文；客服设置：翻译开关、离线通知邮箱及投递状态、回复提醒邮件 |
| 用户与积分 | 本地同步用户和管理员查询、积分流水、充值与余额查询 |
| 角色授权 | 同步灵通角色 ID / 名称，在本系统配置页面与操作权限，控制菜单、路由、按钮及服务端接口 |
| 系统配置 | 字典（多语言）、适用条件问题、提示词模板与预览、AI 供应商 / 模型 / 用途分配、签到积分与项目分配规则、审计日志 |

## 技术栈与仓库结构

服务端领域模型、术语与当前数据库关系图见 [`docs/服务端领域模型/`](docs/服务端领域模型/README.md)。

| 层次 | 技术 |
| --- | --- |
| 后端 API | Fastify 5 + TypeScript ESM，Node.js 24；JSON Schema + `json-schema-to-ts` Type Provider，Swagger / OpenAPI |
| 异步任务 | BullMQ 6 + Transactional Outbox，独立 Worker 进程 |
| 数据库 / 缓存队列 | PostgreSQL 17（原生 `pg`，手写 SQL 与带校验和迁移）/ Redis 7.4（队列、限流、Pub/Sub、在线状态） |
| 对象存储 | Silo（S3 兼容），AWS SDK v3 + presigned URL |
| 文件与邮件 | ExcelJS（导入导出）、JSZip（打包下载）、sharp（图像处理）、Nodemailer（SMTP 邮件） |
| 参展商前端 | Vue 3.5 + Vite 6 + Tailwind CSS 3 + Shadcn-Vue，vue-i18n 12 语言 + RTL |
| 管理后台 | Vben Admin 5 + Ant Design Vue 4，pnpm + Turborepo |
| 工程化 | Docker Compose、Lefthook、commitlint、oxlint / oxfmt、Node 原生测试（`node:test`）、Vitest、GitHub Actions |

```text
booth-ai/
├── apps/
│   ├── server/
│   │   ├── src/http/             # client / admin HTTP 入口
│   │   ├── src/modules/          # 业务模块
│   │   ├── src/infra/            # 数据库、Redis、S3、AI 协议适配
│   │   ├── src/workers/          # 调度、Outbox 分发与恢复、通知 / 邮件投递、客服翻译与维护
│   │   ├── migrations/           # 带校验和的 SQL 迁移
│   │   └── tests/                # Node 原生测试：unit / http / integration / architecture
│   ├── client/                  # 参展商前端
│   └── admin/
│       ├── apps/web-antd/        # 管理端业务应用
│       ├── apps/backend-mock/    # 可选模板 mock 服务
│       └── packages/            # Vben 框架与共享包
├── infra/compose.dev.yaml       # 后端与基础设施开发栈
├── scripts/setup.ps1            # 环境初始化与启动
├── docs/                        # 需求、模块详细设计、领域模型与评审报告
├── .github/workflows/ci.yml     # 三端 CI
└── lefthook.yml                 # Git hooks
```

三个业务子项目独立管理依赖：`apps/server` 使用 npm，`apps/client` 与 `apps/admin` 使用 pnpm。命令在对应子目录执行。`apps/shadcn-vue-admin-main` 是外部模板，不属于业务链路。

## 本地启动

### 1. 启动后端与基础设施

需要 Docker（含 Compose）和 PowerShell。后端运行在容器内，这一步不需要宿主机安装 Node.js。

在仓库根目录执行：

```powershell
# 创建或补齐根目录 .env，构建镜像，执行迁移和存储初始化，启动 API / Worker
./scripts/setup.ps1

# 仅生成或补齐 .env
./scripts/setup.ps1 -SkipStart
```

初始化脚本生成随机本地凭据，已有凭据会保留。根目录 `.env` 永远不要提交，也不要复制到前端配置。

### 2. 分别启动两个前端

Compose 不包含前端服务。前端开发需安装 Node.js 与 pnpm；统一使用 Node.js 24.12+（24.x）可满足服务端和管理端的版本要求。管理端指定 `pnpm@11.16.0`，最低要求 pnpm 11。

在独立终端中，从仓库根目录分别执行：

```powershell
cd apps/client
pnpm install
pnpm dev
```

```powershell
cd apps/admin
pnpm install
pnpm dev:antd
```

两个前端开发服务器都将 `/api` 代理到 `http://localhost:3000`。对接本项目业务时使用真实后端；管理端的 Nitro mock 是可选模板开发能力。

### 本地地址

| 服务 | 默认地址 |
| --- | --- |
| 参展商前端 | [http://localhost:5173](http://localhost:5173) |
| 管理后台（web-antd） | [http://localhost:5666](http://localhost:5666) |
| API | [http://localhost:3000](http://localhost:3000) |
| API 就绪检查 | [http://localhost:3000/health/ready](http://localhost:3000/health/ready) |
| Swagger UI / OpenAPI | [`/docs`](http://localhost:3000/docs) / [`/openapi.json`](http://localhost:3000/openapi.json)（非生产环境） |
| PostgreSQL | `127.0.0.1:55432`，database / user：`booth` |
| Redis | `127.0.0.1:56379` |
| Silo S3 API | [http://localhost:19000](http://localhost:19000)，bucket：`booth-assets` |
| Silo Web Console | [http://localhost:19001](http://localhost:19001) |

### 业务配置

登录依赖灵通外部用户系统，后端地址通过 `EXTERNAL_API_URL` 配置。管理员的页面和操作权限来自本地角色授权，多角色权限取并集，包含 `ROLE_ADMIN` 在内的角色均按保存的权限执行。

真实 AI 调用需在后台「AI 模型配置」中配置供应商凭据、启用模型并分配用途：`selection_parse`（需求解析）、`theme`（主题调整）、`artwork`（四面素材）、`cs_translation`（客服消息翻译）。支持 OpenAI 及兼容协议、Gemini 图像协议、阿里云百炼 Qwen-Image / 万相 2.7 图像协议、火山方舟 Seedream 图像协议；各协议支持的用途以 `GET /api/v1/admin/ai-protocols` 为准。用途配置包含主备顺序与生成积分费用，提示词模板在后台单独管理。

公开选型需要已审核发布的方案；清单下载需要已核验清单，生成需要对应源素材和模型配置。初始化开发栈不等于业务数据与供应商配置已就绪。

## 接口索引

以下列出核心接口及接口族；路径中的 `:code`、`:jobId`、`:projectId`、`:id` 等需替换为实际值。完整参数、请求体、分页与版本要求查看 Swagger、OpenAPI 或对应路由源码。

### 健康与文档

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health/live` | API 进程存活 |
| GET | `/health/ready` | 检查数据库、Redis 与存储桶；依赖异常返回 503 |
| GET | `/docs`、`/openapi.json` | Swagger 与接口 Schema，仅非生产环境开放 |

### 参展商接口

下表路径统一加前缀 **`/api/v1/client`**。公共选型允许访客；个人信息、生成、询价和项目操作等需客户端会话，具体以接口鉴权规则为准。

| 模块 | 方法与路径（相对前缀） | 用途 |
| --- | --- | --- |
| 认证 | `POST /auth/login`、`POST /auth/sync`、`POST /auth/logout`；`GET /me` | 登录、外部 token 同步、登出与当前用户 |
| 积分 | `GET /credits/balance`；`POST /credits/sign-in` | 余额与每日签到 |
| 智选 | `GET /catalog/options`；`POST /requirements/parse`、`POST /scheme-matches` | 公共选项、需求解析与方案匹配 |
| 方案 | `GET /schemes/:code` | 当前公开方案详情 |
| 清单 | `GET /schemes/:code/bill-of-materials`、`GET /schemes/:code/bill-of-materials/download` | 已核验清单与指定 revision 的 Excel 导出 |
| 报馆图 / 平面素材 | `GET /schemes/:code/drawings`、`GET /schemes/:code/artworks`；两者均有 `/download` 与 `/:assetId/download` | 资料列表、指定 revision 的 ZIP 打包、单文件下载链接 |
| 模型文件 | `GET /schemes/:code/model/download` | 模型下载链接 |
| 主题生成 | `GET /theme-models`；`POST /theme-offers`、`POST /theme-jobs`；`GET /theme-jobs/:jobId` | 模型列表、费用确认、提交任务与查询结果 |
| 主题选择 | `PUT /theme-jobs/:jobId/selection` | 按 expectedRevision 选定结果 |
| 主题事件 | `POST /theme-jobs/:jobId/events-ticket`；`GET /theme-jobs/:jobId/events` | 一次性事件票据与 SSE 进度 |
| 四面素材 | `POST /artwork-offers`、`POST /artwork-jobs`；`GET /artwork-jobs`、`GET /artwork-jobs/:jobId` | 费用确认、提交任务、历史任务与详情 |
| 素材事件 / 下载 | `POST /artwork-jobs/:jobId/events-ticket`；`GET /artwork-jobs/:jobId/events`、`GET /artwork-jobs/:jobId/download`、`GET /artwork-jobs/:jobId/assets/:assetId/download` | SSE、ZIP 与 PNG 下载 |
| 询价 / 人工需求 | `GET /schemes/:code/quote-context`；`POST /quote-requests`、`POST /manual-requests` | 询价上下文与需求提交 |
| 我的记录 | `GET /me/searches`、`GET /me/projects`、`GET /me/projects/:projectId` | 检索历史与项目查询 |
| 项目素材 | `PUT /me/projects/:projectId/artworks` | 将本人生成的四面素材绑定项目 |
| 在线客服 | `/customer-service` 下：`POST /visitors`、`POST /visitors/merge`；`POST /conversations`、`GET /conversations/current`、`GET /messages`；`POST /conversations/:conversationId/messages`、`/read`、`/events-ticket`；`GET /conversations/:conversationId/events`；`GET /contexts/:contextId/theme-cover` | 访客身份签发与合并（HttpOnly Cookie）、会话、消息、已读与 SSE |

### 管理端接口

下表路径统一加前缀 **`/api/v1/admin`**。除公共认证入口外，业务接口要求管理端会话与本地操作权限，服务端逐请求校验。

| 模块 | 核心接口（相对前缀） | 用途 |
| --- | --- | --- |
| 认证 / 权限 | `POST /auth/login`、`POST /auth/logout`；`GET /me`、`GET /access`、`GET /permissions` | 登录、当前管理员、权限与可访问路由 |
| 工作台 | `GET /dashboard/workspace`、`GET /dashboard/analytics` | 个人待办与动态、按权限裁剪的统计分析 |
| 角色 | `GET /roles`、`GET /roles/:id`；`PUT /roles/:id/permissions` | 角色同步、授权查询及版本化保存 |
| 用户 / 管理员 | `GET /users`、`GET /users/:id`、`GET /admins`、`GET /admins/:id` | 同步账户查询 |
| 积分 | `GET /credits`、`GET /credits/users/:userId/balance`；`POST /credits/recharge` | 流水、余额与幂等充值 |
| 方案 | `GET /schemes/options`；`GET /schemes`、`POST /schemes`；`GET /schemes/:code`、`PUT /schemes/:code`、`DELETE /schemes/:code` | 方案选项、列表与维护 |
| 方案导入 | `POST /scheme-imports`、`POST /scheme-imports/:importId/commit` | Excel 导入预览与确认 |
| 审核发布 | `GET /schemes/:code/readiness`；`POST /schemes/:code/reviews`、`POST /schemes/:code/publish`、`POST /schemes/:code/unpublish` | 就绪检查、审核、发布与下架 |
| 资源 | `GET /assets`；`GET /schemes/:code/assets`、`POST /schemes/:code/assets`；`PATCH /schemes/:code/assets/:assetId`、`DELETE /schemes/:code/assets/:assetId`；`POST /schemes/:code/assets/:assetId/versions`、`GET /schemes/:code/assets/:assetId/download` | 按资源类型授权的资产维护与版本管理 |
| 清单 | `GET /bill-of-materials`；`/schemes/:code/bill-of-materials` 下的读取、导入及确认、条目维护、核验、删除与下载接口 | 简化清单完整生命周期 |
| 检索运营 | `GET /scheme-searches`、`GET /scheme-searches/:id`、`GET /scheme-searches/visitors`、`GET /scheme-searches/statistics` | 检索查询、访客与统计 |
| 生成任务 | `GET /generation-jobs`、`GET /generation-jobs/:jobId` | 主题 / 四面素材任务及结果 |
| 项目 | `GET /project-assignees`、`GET /projects`、`GET /projects/:projectId`、`GET /projects/:projectId/events`；`PUT /projects/:projectId/assignee`、`POST /projects/:projectId/follow-ups`、`PUT /projects/:projectId/scheme` | 承接、改派、跟进与方案关联 |
| 报价 / 项目附件 | `GET /projects/:projectId/quotation`、`PUT /projects/:projectId/quotation`、`GET /projects/:projectId/quotation/download`、`GET /projects/:projectId/assets/:versionId/download` | 报价版本、Excel 导出与项目资料下载链接 |
| 通知 | `GET /project-notifications`、`GET /project-notifications/:id`；`POST /project-notifications/:id/read`、`POST /project-notifications/read-all` | 收件箱、详情与已读管理 |
| 在线客服 | `/customer-service` 下：`GET /conversations`、`GET /conversations/:conversationId`（含 `/messages`）；`POST /conversations/:conversationId/claim`、`/release`、`/transfer`、`/close`、`/messages`、`/read`；`GET /agents`、`PUT /presence`；`POST /events-ticket`、`GET /events`；`GET /settings`、`PUT /settings` | 工作台会话流转、坐席在线状态、SSE 与客服设置（按 `customer-service.*` 权限） |
| AI 配置 | `GET /ai-protocols`；供应商 `/ai-providers`、模型 `/ai-models` 的维护接口；`GET /ai-model-assignments`、`PUT /ai-model-assignments/:purpose` | 协议能力、供应商与模型、用途主备及积分配置 |
| 提示词 | `GET /prompt-templates/definitions`、`POST /prompt-templates/preview`；`GET /prompt-templates`、`POST /prompt-templates`、`GET /prompt-templates/:id`、`PATCH /prompt-templates/:id` | 变量定义、预览、模板维护与启停 |
| 系统数据 | `/dictionaries` 及条目维护接口、`/applicability-questions` 维护接口；`GET /audit-logs` | 字典、适用条件问题与审计查询 |

当前 `src/app.ts` 注册 client 和 admin 门户；`src/http/su/` 目录尚未注册为可用 API。

### 请求与响应约定

- 登录返回本平台 `accessToken`，后续认证请求使用 `Authorization: Bearer <token>`。客户端与管理端会话隔离；SSE 使用与原会话绑定的一次性 `ticket`。
- 大多数业务 JSON 成功响应为 `{ code: 0, data }`。登出仅返回 `{ code: 0 }`；客户端简化清单查询直接返回 `{ schemeCode, revision, status, verifiedAt, items }`；健康接口、文件下载和 SSE 使用各自响应格式。
- 错误统一为 `{ error: { code, reason?, details?, message, requestId } }`，由 `src/http/errors.ts` 生成并以 `ErrorResponse` schema 声明在每条路由上。`code` 只区分大类（`VALIDATION_ERROR`、`REQUEST_ERROR`、`INTERNAL_ERROR`）；`reason` 区分具体业务错误（如 `INSUFFICIENT_CREDITS`，未知路由为 `ROUTE_NOT_FOUND`）；`details` 只在带 reason 的 4xx 中出现；`message` 为通用文案，不透传异常信息。响应头包含 `x-request-id`。
- 需要幂等的业务按 Schema 提交 `requestKey`；版本化修改按接口要求提交 `expectedRevision` 或 `expectedVersion`，下载按要求指定 `revision`。
- 生成任务异步执行，新任务通常返回 202；客户端通过任务详情轮询或 SSE 跟踪进度与最终结果。任务受理不代表生成完成。
- 文件链接由服务端签名，使用公开 S3 端点；打包下载、清单及报价导出等接口直接返回文件流。

## 开发与验证

### 容器命令（仓库根目录）

```powershell
# 重建并启动后端开发栈
docker compose --env-file .env -f infra/compose.dev.yaml up -d --build

# 服务端类型检查 + 测试 + 构建（不包含两个前端）
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm check

# 基础设施冒烟：健康检查、Redis、S3、DB → Outbox → BullMQ → Worker → DB 与幂等
docker compose --env-file .env -f infra/compose.dev.yaml --profile tools run --rm smoke

# 手动迁移 / 初始化存储桶
docker compose --env-file .env -f infra/compose.dev.yaml run --rm migrate
docker compose --env-file .env -f infra/compose.dev.yaml run --rm storage-init

# 停止服务，保留 volume 数据
docker compose --env-file .env -f infra/compose.dev.yaml down
```

`smoke` 验证基础设施任务链路，不覆盖真实 SSO、AI 供应商调用或完整前端业务流程。

### 子项目命令

下列命令在表中指定目录执行；宿主机运行服务端前需安装 npm 依赖，并提供 `src/config.ts` 要求的环境变量（根目录 `.env` 是 Compose 的输入，不是宿主机 API / Worker 的完整配置）。

| 工作目录 | 命令 | 用途 |
| --- | --- | --- |
| 仓库根目录 | `./scripts/package-server.ps1 -Version <版本>` | 打包生产服务端镜像并导出到 `release/`，内置本地 `.env` 的 SMTP 配置 |
| `apps/server` | `npm ci` | 安装锁定依赖 |
| `apps/server` | `npm run dev:api` / `npm run dev:worker` | 分别启动 API / Worker watch 进程 |
| `apps/server` | `npm run check` / `npm test` / `npm run build` | 类型检查、测试、编译 |
| `apps/server` | `npm run lint` / `npm run format:check` | oxlint 与 oxfmt 格式检查 |
| `apps/client` | `pnpm build` / `pnpm test` / `pnpm preview` | vue-tsc 类型检查与生产构建 / Node 原生测试 / 产物预览 |
| `apps/admin` | `pnpm check:type` / `pnpm test:unit` / `pnpm build:antd` | 类型检查、单元测试、业务应用构建 |
| `apps/admin` | `pnpm check` | 循环依赖、依赖、类型与拼写检查 |

服务端测试包含无需外部服务的测试及需专用数据库环境变量的集成测试；后者在配置缺失时可能跳过，不能将测试进程成功等同于所有集成用例已执行。容器内的 `check` 服务会重建 `booth_test` 库并执行全部测试（含集成测试）。

### Git hooks 与 CI

- `lefthook.yml`：提交前对 server 暂存文件跑 oxlint / oxfmt、对 admin 暂存文件跑 lint 与类型检查；commit-msg 按 `commitlint.config.mjs` 校验 Conventional Commits；推送前按改动范围执行各子项目检查。
- `.github/workflows/ci.yml`：PR 与推送 `main` 时，server 执行容器 `check` + 启动开发栈 + `smoke`，client 执行 `pnpm build` + `pnpm test`，admin 执行 `typecheck` + `pnpm test:antd`。

## 架构与配置要点

- **API / Worker 分进程**：`src/api.ts` 提供 HTTP；`src/worker.ts` 处理 Foundation、主题与四面素材队列、Outbox 分发与恢复、项目通知与询价回执邮件投递，以及客服翻译、离线 / 回复邮件、消息保留和坐席巡检。HTTP 层只负责校验、鉴权与映射，不直接访问数据库；业务放在 `src/modules/`，模块依赖方向与表写入归属由架构测试约束。
- **契约守卫**：每条路由声明请求与响应 schema（Type Provider 推导 TS 类型），`src/http/response-guard.ts` 在 test 环境对 schema 未声明字段或类型强转直接报错，development 记录日志，production 记录并回退为原始 JSON。
- **实时推送**：主题 / 素材进度与客服消息均通过 SSE 下发，连接前先换取与会话绑定的一次性 ticket；客服事件经 Redis Pub/Sub 广播，心跳时复核登录会话与最新权限。
- **事务性 Outbox**：任务与 Outbox 在同一数据库事务写入，使用确定性 jobId 与数据库状态控制重复执行；调用 AI / 外部 API 时不持有数据库锁。
- **积分账本**：生成费用先预占，再根据结果结算与释放，保留流水及对账约束，详见[积分账本对接契约](docs/一期功能拆分/积分账本对接契约.md)。
- **S3 双端点**：`S3_ENDPOINT` 用于容器内部访问，`S3_PUBLIC_ENDPOINT` 用于浏览器签名链接，禁止向前端暴露容器内部 hostname。方案基线资产与用户生成素材隔离。
- **迁移与健康**：已执行 SQL 迁移带 SHA-256 校验和，只追加新迁移。API 就绪检查不代表 Worker 或真实 AI 调用就绪；Worker 状态见 `/tmp/worker-status.json`，健康标记为 `/tmp/worker-ready`。

| 配置位置 | 关键配置 |
| --- | --- |
| 根目录 `.env` / Compose | 本地 DB、Redis、S3 凭据、`SESSION_SECRET`、`AI_MODEL_ENCRYPTION_KEY`、`EXTERNAL_API_URL` |
| 服务端 `src/config.ts` | `DATABASE_URL`、`REDIS_URL`、S3 配置、`CORS_ORIGINS`、会话及可选通知 webhook 配置 |
| client Vite 环境 | `VITE_API_BASE_URL`（默认同源）、`VITE_LINGTONG_API_URL`、`VITE_APP_TITLE` |
| admin `apps/web-antd` Vite 环境 | `VITE_GLOB_API_URL`、`VITE_PORT`、`VITE_APP_STORE_SECURE_KEY` 等 |

密钥只保留在服务端配置或加密存储中。生产环境需替换管理端默认的 `VITE_APP_STORE_SECURE_KEY`；客户端使用 HTML5 history，部署时配置路由 fallback 到 `index.html`。前后端跨域直连时需按实际来源配置 `CORS_ORIGINS`，当前 Compose 默认放行 `5173` / `5174`，开发端通常通过 Vite 同源代理访问。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [一期功能拆分索引](docs/一期功能拆分/README.md) | 智选、主题、素材、清单、报价与管理模块设计 |
| [1Panel 服务端部署](docs/1Panel服务端部署.md) | 服务端打包发布、邮件配置、编排部署与运维 |
| [服务端领域模型](docs/服务端领域模型/README.md) | 领域模型、术语表、全量表设计与数据库 ER 图 |
| [在线客服详细设计](docs/一期功能拆分/在线客服模块详细设计.md) / [开发计划](docs/一期功能拆分/在线客服模块开发计划.md) | 自研客服的会话模型、实时推送、翻译、邮件与保留策略 |
| [积分账本对接契约](docs/一期功能拆分/积分账本对接契约.md) | 预占、结算、释放与对账约束 |
| [AI 模型接入与配置](docs/一期功能拆分/AI模型接入与配置.md) | 供应商 / 模型 / 用途配置与协议适配 |
| [提示词模板业务接入](docs/一期功能拆分/提示词模板业务接入说明.md) | 模板选择、变量与业务调用 |
| [资料批量下载](docs/一期功能拆分/资料批量下载实现说明.md) | 报馆图与平面素材 ZIP 交付 |
| [四面素材交付](docs/一期功能拆分/AIGC四面素材交付实现说明.md) | 四方向生成、下载与项目关联 |

各子项目开发约定见 [server](apps/server/AGENTS.md)、[client](apps/client/AGENTS.md)、[admin](apps/admin/AGENTS.md) 的 `AGENTS.md`。
