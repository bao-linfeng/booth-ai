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
├── http/                 # client / admin / su HTTP 路由、校验、响应映射
├── modules/              # identity / schemes / assets / selection / selection-analytics
│                         # generation / prompts / credits / projects / tasks 业务模块
├── workers/              # Outbox 轮询分发与生成任务恢复调度
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
- **后端依赖边界**：HTTP/Worker 调用业务模块；`modules/` 不得导入 `http/`、Fastify 或 Worker 调度实现。`infra/` 不得反向依赖业务模块。边界说明见 `docs/server-module-boundaries.md`。
- **管理后台（`apps/admin`）**：通用工具类必须优先使用 `@vben/utils`，参考官方文档 [Vben Admin 工具文档](https://doc.vben.pro/guide/essentials/utils.html)。涵盖类型判断、日期处理、树结构操作、对象合并与差异对比（diff）、防抖节流、文件下载/转换等，严禁重复造轮子或随意引入第三方同类工具库。
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

---

## 管理后台偏好配置（`apps/admin`）

框架默认配置入口：`apps/admin/src/preferences.ts`，覆盖时只需传入需要修改的字段，未传字段保持框架默认值。

### 顶层结构 `Preferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `app` | `AppPreferences` | 全局配置 |
| `breadcrumb` | `BreadcrumbPreferences` | 面包屑配置 |
| `copyright` | `CopyrightPreferences` | 版权配置 |
| `footer` | `FooterPreferences` | 底栏配置 |
| `header` | `HeaderPreferences` | 顶栏配置 |
| `logo` | `LogoPreferences` | Logo 配置 |
| `navigation` | `NavigationPreferences` | 导航配置 |
| `shortcutKeys` | `ShortcutKeyPreferences` | 快捷键配置 |
| `sidebar` | `SidebarPreferences` | 侧边栏配置 |
| `tabbar` | `TabbarPreferences` | 标签页配置 |
| `theme` | `ThemePreferences` | 主题配置 |
| `transition` | `TransitionPreferences` | 动画配置 |
| `widget` | `WidgetPreferences` | 功能部件配置 |

### `AppPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `accessMode` | `AccessModeType` | 权限模式 |
| `authPageLayout` | `AuthPageLayoutType` | 登录注册页面布局 |
| `checkUpdatesInterval` | `number` | 检查更新轮询时间 |
| `colorGrayMode` | `boolean` | 灰色模式 |
| `colorWeakMode` | `boolean` | 色弱模式 |
| `compact` | `boolean` | 紧凑模式 |
| `contentCompact` | `ContentCompactType` | 内容紧凑模式 |
| `contentCompactWidth` | `number` | 内容紧凑宽度 |
| `contentPadding` | `number` | 内容内边距 |
| `contentPaddingBottom` | `number` | 内容底部内边距 |
| `contentPaddingLeft` | `number` | 内容左侧内边距 |
| `contentPaddingRight` | `number` | 内容右侧内边距 |
| `contentPaddingTop` | `number` | 内容顶部内边距 |
| `defaultAvatar` | `string` | 应用默认头像 |
| `defaultHomePath` | `string` | 默认首页地址 |
| `dynamicTitle` | `boolean` | 动态标题 |
| `enableCheckUpdates` | `boolean` | 是否开启检查更新 |
| `enablePreferences` | `boolean` | 是否显示偏好设置 |
| `enableCopyPreferences` | `boolean` | 是否显示复制偏好设置按钮 |
| `enableRefreshToken` | `boolean` | 是否开启 refreshToken |
| `isMobile` | `boolean` | 是否移动端 |
| `layout` | `LayoutType` | 布局方式 |
| `locale` | `SupportedLanguagesType` | 支持的语言 |
| `loginExpiredMode` | `LoginExpiredModeType` | 登录过期模式 |
| `name` | `string` | 应用名 |
| `preferencesButtonPosition` | `PreferencesButtonPositionType` | 偏好设置按钮位置 |
| `watermark` | `boolean` | 是否开启水印 |
| `zIndex` | `number` | z-index |

### `BreadcrumbPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `enable` | `boolean` | 面包屑是否启用 |
| `hideOnlyOne` | `boolean` | 只有一个时是否隐藏 |
| `showHome` | `boolean` | 首页图标是否可见 |
| `showIcon` | `boolean` | 图标是否可见 |
| `styleType` | `BreadcrumbStyleType` | 面包屑风格 |

### `CopyrightPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `companyName` | `string` | 版权公司名 |
| `companySiteLink` | `string` | 版权公司名链接 |
| `date` | `string` | 版权日期 |
| `enable` | `boolean` | 版权是否可见 |
| `icp` | `string` | 备案号 |
| `icpLink` | `string` | 备案号链接 |
| `settingShow?` | `boolean` | 设置面板是否显示 |

### `FooterPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `enable` | `boolean` | 底栏是否可见 |
| `fixed` | `boolean` | 底栏是否固定 |
| `height` | `number` | 底栏高度 |

### `HeaderPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `enable` | `boolean` | 顶栏是否启用 |
| `height` | `number` | 顶栏高度 |
| `hidden` | `boolean` | 顶栏是否隐藏（css 隐藏） |
| `menuAlign` | `LayoutHeaderMenuAlignType` | 顶栏菜单位置 |
| `mode` | `LayoutHeaderModeType` | header 显示模式 |

### `LogoPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `enable` | `boolean` | logo 是否可见 |
| `fit` | `'contain' \| 'cover' \| 'fill' \| 'none' \| 'scale-down'` | logo 图片适应方式 |
| `source` | `string` | logo 地址 |
| `sourceDark?` | `string` | 暗色主题 logo 地址（可选，不设则使用 source） |

### `NavigationPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `accordion` | `boolean` | 导航菜单手风琴模式 |
| `split` | `boolean` | 导航菜单是否切割（仅 layout=mixed-nav 生效） |
| `styleType` | `NavigationStyleType` | 导航菜单风格 |

### `ShortcutKeyPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `enable` | `boolean` | 是否启用快捷键（全局） |
| `globalLockScreen` | `boolean` | 是否启用全局锁屏快捷键 |
| `globalLogout` | `boolean` | 是否启用全局注销快捷键 |
| `globalPreferences` | `boolean` | 是否启用全局偏好设置快捷键 |
| `globalSearch` | `boolean` | 是否启用全局搜索快捷键 |

### `SidebarPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `autoActivateChild` | `boolean` | 点击目录时自动激活子菜单 |
| `collapsed` | `boolean` | 侧边栏是否折叠 |
| `collapsedButton` | `boolean` | 侧边栏折叠按钮是否可见 |
| `collapsedShowTitle` | `boolean` | 折叠时是否显示 title |
| `collapseWidth` | `number` | 侧边栏折叠宽度 |
| `enable` | `boolean` | 侧边栏是否可见 |
| `expandOnHover` | `boolean` | 菜单自动展开状态 |
| `extraCollapse` | `boolean` | 侧边栏扩展区域是否折叠 |
| `extraCollapsedWidth` | `number` | 侧边栏扩展区域折叠宽度 |
| `fixedButton` | `boolean` | 侧边栏固定按钮是否可见 |
| `hidden` | `boolean` | 侧边栏是否隐藏（css） |
| `mixedWidth` | `number` | 混合侧边栏宽度 |
| `width` | `number` | 侧边栏宽度 |

### `TabbarPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `draggable` | `boolean` | 是否开启多标签页拖拽 |
| `enable` | `boolean` | 是否开启多标签页 |
| `height` | `number` | 标签页高度 |
| `keepAlive` | `boolean` | 开启标签页缓存功能 |
| `maxCount` | `number` | 限制最大数量 |
| `middleClickToClose` | `boolean` | 是否点击中键时关闭标签 |
| `persist` | `boolean` | 是否持久化标签 |
| `showIcon` | `boolean` | 是否开启多标签页图标 |
| `showMaximize` | `boolean` | 显示最大化按钮 |
| `showMore` | `boolean` | 显示更多按钮 |
| `styleType` | `TabsStyleType` | 标签页风格 |
| `wheelable` | `boolean` | 是否开启鼠标滚轮响应 |

### `ThemePreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `builtinType` | `BuiltinThemeType` | 内置主题名 |
| `colorDestructive` | `string` | 错误色 |
| `colorPrimary` | `string` | 主题色 |
| `colorSuccess` | `string` | 成功色 |
| `colorWarning` | `string` | 警告色 |
| `mode` | `ThemeModeType` | 当前主题 |
| `radius` | `string` | 圆角 |
| `semiDarkHeader` | `boolean` | 是否开启半深色 header（仅 theme=light 生效） |
| `semiDarkSidebar` | `boolean` | 是否开启半深色菜单（仅 theme=light 生效） |

### `TransitionPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `enable` | `boolean` | 页面切换动画是否启用 |
| `loading` | `boolean` | 是否开启页面加载 loading |
| `name` | `PageTransitionType \| string` | 页面切换动画名 |
| `progress` | `boolean` | 是否开启页面加载进度动画 |

### `WidgetPreferences`

| 字段 | 类型 | 说明 |
|------|------|------|
| `fullscreen` | `boolean` | 是否启用全屏部件 |
| `globalSearch` | `boolean` | 是否启用全局搜索部件 |
| `languageToggle` | `boolean` | 是否启用语言切换部件 |
| `lockScreen` | `boolean` | 是否开启锁屏功能 |
| `notification` | `boolean` | 是否显示通知部件 |
| `refresh` | `boolean` | 显示刷新按钮 |
| `sidebarToggle` | `boolean` | 是否显示侧边栏显示/隐藏部件 |
| `themeToggle` | `boolean` | 是否显示主题切换部件 |

---

## 管理后台工具类规范（`@vben/utils`）

管理后台开发中，所有通用工具函数优先使用 `@vben/utils`（官方文档：https://doc.vben.pro/guide/essentials/utils.html ）。`@vben/utils` 已在各 app 统一引入，无需单独安装。

### 常用工具速查

| 分类 | 常用函数 / 能力 | 说明 / 示例 |
|------|-----------------|-------------|
| **类型判断** | `isBoolean`, `isFunction`, `isNumber`, `isString`, `isObject`, `isArray`, `isDate`, `isEmpty`, `isNil`, `isHttpUrl`, `isWindow` | 类型守卫与基础类型断言 |
| **日期处理** | `formatDate`, `formatDateTime`, `isDate` | 基于 Day.js 格式化日期，按当前时区输出，支持 Date/Dayjs/number/string |
| **对象与数组** | `diff`, `cloneDeep`, `merge`, `deepMerge`, `uniqueByField` | 深度对比/克隆/合并，`diff` 返回变化字段（数组忽略顺序） |
| **树结构处理** | `filterTree`, `mapTree`, `findNodePath`, `treeToList`, `listToTree`, `traverseTreeValues` | 针对层级/菜单/组织架构树的高效遍历与转换 |
| **函数控制** | `debounce`, `throttle`, `sleep` | 防抖/节流/睡眠（来自 `es-toolkit/compat`） |
| **文件与下载** | `downloadFileFromBase64`, `downloadFileFromBlob`, `downloadFileFromImageUrl`, `downloadFileFromUrl`, `urlToBase64`, `openWindow` | 常见文件下载、图片转 Base64 与新窗口打开 |
| **样式与 DOM** | `cn` (clsx + tailwind-merge), `getPopupContainer`, `triggerWindowResize` | 类名合并与常见 DOM 操作 |
| **业务辅助** | `findMenuByPath`, `generateMenus`, `generateRoutesFrontend`, `generateRoutesBackend` | 路由菜单生成与查找 |

> **注意**：`@vben-core/shared/constants` 子模块未被重新导出，如需常量（如 `ELEMENT_ID_LAYOUT_SCROLL`）需直接从 `@vben-core/shared/constants` 引入。
