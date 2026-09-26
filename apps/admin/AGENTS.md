# AGENTS.md — apps/admin（Vben Admin 5 管理后台）

这是独立于仓库根目录的 pnpm + Turborepo monorepo。**所有命令必须在 `apps/admin/` 下执行，不要从仓库根目录调用。**

---

## 结构一览

```
apps/admin/
├── apps/
│   ├── web-antd/          # 实际业务应用（Ant Design Vue 4）← 主要工作区
│   └── backend-mock/      # Nitro mock 服务（本地开发可选）
├── packages/
│   ├── @core/             # 框架核心（ui-kit、composables、preferences）— 不要随意改
│   ├── effects/           # 业务效果层：access、request、hooks、layouts、plugins
│   ├── stores/            # Pinia stores（@vben/stores）
│   ├── locales/           # i18n
│   └── utils/ types/ icons/ styles/ constants/ preferences/
├── internal/              # 工具链配置（lint、tsconfig、vite-config、tailwind-config）
└── scripts/               # 运维脚本（clean、circular 检查等）
```

**实际业务代码在 `apps/web-antd/src/`，不是 `packages/`。**

---

## 常用命令

```powershell
# 开发
pnpm dev:antd              # 只启动 web-antd（端口 5666）
pnpm dev                   # 所有子包（turbo-run 并行）

# 构建
pnpm build:antd            # 只构建 web-antd
pnpm build                 # 全量构建（Turbo，--max-old-space-size=8192）

# 类型检查
pnpm check:type            # turbo run typecheck（全部包）

# 完整检查（CI 顺序）
pnpm check                 # check:circular → check:dep → check:type → check:cspell

# 测试
pnpm test:unit             # vitest run --dom（happy-dom 环境）
pnpm vitest run <path/to/test.ts>  # 单文件

# 格式化 / 代码质量
pnpm lint                  # vsh lint（eslint + oxlint）
pnpm format                # vsh lint --format（oxfmt）

# 清理
pnpm clean                 # 删除 dist、.turbo 等产物
pnpm reinstall             # clean --del-lock + pnpm install
```

---

## web-antd 内部结构

```
apps/web-antd/src/
├── api/          # HTTP 请求：request.ts 配置 RequestClient，api/core/ 放接口定义
├── adapter/      # 适配 vben 框架的 form、vxe-table 配置
├── router/       # 路由：routes/modules/ 下按业务拆分，access.ts 控制权限路由
├── store/        # 应用级 Pinia store（auth.ts 管登录态）
├── views/        # 页面组件（_core/ 为框架核心页，dashboard/、demos/ 为业务页）
├── layouts/      # 布局覆写
├── locales/      # 应用级 i18n
└── preferences.ts # 应用偏好覆写（覆盖 @vben/preferences 默认值）
```

路由模块文件加在 `src/router/routes/modules/`，自动被 `routes/index.ts` 扫描注册。

---

## 关键约定

### 工具类使用规范（优先使用 `@vben/utils`）

- **优先原则**：管理后台业务开发中，所有通用工具函数**必须优先参考并使用 `@vben/utils`**，禁止重复手写同类工具或随意安装外部冗余依赖（如 lodash、dayjs 等，优先使用内置导出）。
- **文档参考**：https://doc.vben.pro/guide/essentials/utils.html
- **模块继承**：`@vben/utils` 在各 app 下已统一引入，重新导出了 `@vben-core/shared` 的 `cache`、`color`、`utils` 以及业务 helpers。
- **常量导入注意**：`@vben-core/shared/constants` 子模块**未**被重新导出，如需使用常量（如 `ELEMENT_ID_LAYOUT_SCROLL`），需直接从 `@vben-core/shared/constants` 引入。
- **常用工具分类**：
  - **类型判断**：`isBoolean`, `isFunction`, `isNumber`, `isString`, `isObject`, `isArray`, `isDate`, `isEmpty`, `isNil`, `isHttpUrl`, `isWindow` 等（类型守卫）
  - **日期处理**：`formatDate`, `formatDateTime`, `isDate`（基于 Day.js 封装，支持多类型输入与当前时区格式化）
  - **对象与数组**：`diff`（深度对比返回差异对象，数组无序对比）、`cloneDeep`、`merge`、`deepMerge`、`uniqueByField`
  - **树结构操作**：`filterTree`, `mapTree`, `findNodePath`, `treeToList`, `listToTree`, `traverseTreeValues`
  - **异步与函数控制**：`debounce`, `throttle`, `sleep`（基于 `es-toolkit/compat`）
  - **文件下载与转换**：`downloadFileFromBase64`, `downloadFileFromBlob`, `downloadFileFromImageUrl`, `downloadFileFromUrl`, `urlToBase64`, `openWindow`
  - **样式与 DOM**：`cn`（Tailwind 类名合并）、`getPopupContainer`、`triggerWindowResize`
  - **缓存管理**：`StorageManager` 及各种 Storage Driver
  - **业务辅助**：`findMenuByPath`, `generateMenus`, `generateRoutesFrontend`, `generateRoutesBackend`

### 包引用别名

- `#/*` → `./src/*`（仅在 web-antd 内有效，见 package.json `imports`）
- `@vben/*` → workspace 包，不要直接改 `packages/` 里的核心代码，除非明确在修改框架层

### HTTP 请求

- `requestClient`（`src/api/request.ts`）：自动注入 `Authorization: Bearer <token>` + 语言头；响应拦截期望 `{ code: 0, data: ... }` 格式
- `baseRequestClient`：无拦截器的裸客户端，用于不需要鉴权的请求
- **不支持 refresh token**（`doRefreshToken` 直接 reject），token 过期直接跳登录页

### 环境变量（web-antd）

- `.env`：`VITE_APP_TITLE`、`VITE_APP_NAMESPACE`、`VITE_APP_STORE_SECURE_KEY`（**必须替换默认值**）
- `.env.development`：`VITE_PORT=5666`、`VITE_GLOB_API_URL=/api`（代理到后端）
- `.env.production`：`VITE_GLOB_API_URL` 改为真实 API 地址，`VITE_ROUTER_HISTORY=hash`
- Nitro mock（`VITE_NITRO_MOCK=true`）：开发时启用 backend-mock 作为接口服务

### 权限系统

- 菜单/按钮权限由 `@vben/access` 包管理，access codes 从 `getAccessCodesApi()` 获取
- 路由 meta 中的 `authority` 字段控制角色访问

### 提交规范

- pre-commit hooks（lefthook）顺序执行：oxlint → oxfmt → eslint → stylelint → check:type（**串行，低配机会慢**）
- commit message 必须符合 conventional commits，由 commitlint 校验

---

## 工具链

| 工具      | 用途                                    |
| --------- | --------------------------------------- |
| Turbo     | 任务并行编排，缓存 `dist/`、`.turbo/`   |
| oxfmt     | 快速格式化（替代 Prettier）             |
| oxlint    | 快速 lint（+ type-aware，4 线程）       |
| eslint    | 补充规则，staged 时修复                 |
| stylelint | CSS/SCSS/Vue style 检查                 |
| vue-tsc   | TypeScript 类型检查（`typecheck` 任务） |
| vitest    | 单元测试（happy-dom，e2e 目录排除）     |

---

## 常见陷阱

- **Node 版本**：要求 `^22.18.0 || ^24.12.0`，pnpm 要求 `>=11.0.0`（`packageManager: pnpm@11.16.0`）
- **只允许 pnpm**：`preinstall` 脚本会阻止 npm/yarn，误用直接报错
- `postinstall` 会对所有包执行 `stub`（tsdown stub），安装后自动生成 stub，不需手动跑
- `pnpm dev` 使用 `turbo-run`，不是普通 `turbo run dev`，两者行为不同
- Vitest 的 `--dom` flag 等价于 `environment: 'happy-dom'`，happy-dom v20+ 默认禁用 JS eval，已在 vitest.config.ts 中设置 `handleDisabledFileLoadingAsSuccess: true`
- `VITE_APP_STORE_SECURE_KEY` 用于 localStorage 加密，**生产环境必须换掉**默认值
- `pnpm check:cspell` 检查英文拼写，中文注释可能触发误报，不要随意加奇怪英文
