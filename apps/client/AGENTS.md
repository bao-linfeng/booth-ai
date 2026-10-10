# AGENTS.md — apps/client（参展商前端）

参展商公众端。Vue 3.5 + Vite 6 + Tailwind CSS 3 + Shadcn-Vue（Radix Vue）。
跨项目信息（环境初始化、端口、前后端契约、全局约定）见根目录 [`AGENTS.md`](../../AGENTS.md)；此文件仅记录 client 专属内容。

## 命令（包管理器：pnpm）

```powershell
pnpm dev          # 开发服务器（http://localhost:5173）
pnpm build        # vue-tsc 类型检查 + 生产构建
pnpm build:prod   # 同上，显式 --mode production
pnpm preview      # 预览构建产物
pnpm test         # node:test 跑 tests/*.test.mjs（逐个文件串行）
node --test tests/<file>.test.mjs  # 单文件
```

- 无独立 lint 脚本；类型验证入口是 `pnpm build`（内含 `vue-tsc --noEmit`）。
- **检查流程**：非平凡改动后依次跑 `pnpm build`、`pnpm test`，两者都通过才算完成；不要并行跑，测试文件也保持 `--test-concurrency=1`（单文件峰值约 1 GB）。

## 测试约定（`tests/`）

- 每个文件自建 Vite SSR server + happy-dom，加载真实 `.vue` 页面；只在 `resolveId`/`load` 里替换网络层（`lib/api-client`）、登录态（`stores/auth`）、布局壳等外部依赖，业务模块与 sessionStorage 读写保持真实。`vue-i18n` 统一换成 `tests/mock-i18n.ts`（直接读 `zh.json`）。
- **DOM 节点禁止直接传给 `assert.*`**：断言失败时报告器会深度展开 happy-dom 节点，曾单进程占用 14 GB。节点比较用 `tests/dom-assert.mjs` 的 `assertNoNode` / `assertSameNode` / `assertNotSameNode`。
- 跨页面交接（sessionStorage 草稿、智选会话、路由 query）必须有经过真实页面写入 → 真实页面读取的测试，不能只在读取端手工构造数据；参考 `selection-quote-flow.test.mjs`（智选 → 方案详情 → 报价）。改动 `features/selection/session.ts`、`handoff.ts` 或这几页的跳转参数时必须跑它。

## 后端对接

- 开发时 `vite.config.ts` 把 `/api` 代理到 `http://localhost:3000`（本仓库 `apps/server`）。
- `src/lib/api-client.ts` 区分两类请求：`apiFetch` 访问本平台 API（`VITE_API_BASE_URL`，默认空串即同源走代理）；`lingtongFetch` / `lingtongPublicFetch` 访问灵通企业 API（`VITE_LINGTONG_API_URL`，默认 `https://api.lingtong.net.cn`，用于 SSO 登录等）。
- 业务接口封装在 `src/services/api/`，页面不直接拼 HTTP 请求。
- `apiFetch` 带 `credentials: 'include'` 并统一附加 `X-CS-Visitor: 1`：客服访客令牌只在服务端写入的 HttpOnly Cookie 中，前端只在 localStorage 记不含机密的标记 `booth-ai:cs-visitor`，不要把令牌改回脚本可读的存储。

---

## 路径别名

| 别名 | 实际路径 |
|------|----------|
| `@/*` | `src/*` |
| `@/components` | `src/components` |
| `@/lib/utils` | `src/lib/utils`（`cn()` helper） |

`@` 在 `vite.config.ts` 和 `tsconfig.json` 均已配置，两处必须保持一致。

---

## 组件系统

- **Shadcn-Vue**（`new-york` 风格，`slate` 为基础色）：基础 UI 原语在 `src/components/ui/`，用 CLI 添加新组件：`pnpx shadcn-vue@latest add <component>`。
- **CVA**（`class-variance-authority`）+ `cn()`（clsx + tailwind-merge）：所有组件变体通过这两个工具定义，不要手拼 Tailwind 类字符串做条件判断。
- **Radix Vue**：Dialog、Select、Popover 等无障碍原语由 Radix Vue 驱动，不要自己实现。

---

## 主题 / 样式

- 颜色系统完全基于 HSL CSS 变量（`--background`, `--primary`, `--foreground` 等），**不要在代码里硬编码颜色值**。
- 多主题 CSS 变量定义在 `src/components/theming/themes.css`，主题逻辑在 `src/utils/theme.ts` 和 `src/components/theming/themeManager.ts`。
- 暗色模式：HTML 根元素 `class` 切换（`darkMode: ["class"]`），`index.html` 内联脚本在页面加载前读取 `localStorage.getItem('darkMode')` 防止 FOUC，不要移除此脚本。
- Tailwind safelist 已为动态主题类名（`theme-*`, `bg-zinc-*` 等）加白名单，动态拼接主题类名是安全的。

---

## 路由

- 所有页面组件均为**懒加载**（动态 import），新增路由必须沿用此模式。
- 使用 HTML5 history 模式（`createWebHistory()`），部署时需服务器配置 fallback 到 `index.html`。
- `/buildy/:pathMatch(.*)*` 重定向到 `/buildy/index.html`（独立子应用入口），不要删除。

---

## 状态管理

- **有 Pinia**（`pinia-plugin-persistedstate` 持久化），Store 定义在 `src/stores/`。
- 轻量的跨组件状态优先用 composables（`src/composables/`）和 `@vueuse/core` 管理；需要持久化或全局共享的状态放 Store。
- 全局初始化顺序（`main.ts`）：`initializeTheme()` → `useCollecty()` → 创建 app → 挂载 router → mount。不要改变此顺序。

### 页面接入在线客服

在组件 setup 中从 `@/features/customer-service/useCustomerServiceContext` 引用：

- 方案：`useSchemeCustomerService(() => ({ schemeCode, themeJobId }))`，`themeJobId` 可省略，来源默认 `scheme_detail`。
- 项目：`useProjectCustomerService(() => project)`，`project` 提供 `projectId`、`projectNo`，来源默认 `my_project`；创建成功回执传第二参 `quote_receipt`。
- getter 读取响应式页面数据，未加载成功或不适用时返回 `null` / `undefined`。函数自动同步客服输入框上方的发送按钮，组件卸载时清理上下文。
- 返回的 `consult` 可直接绑定 `@click="consult"`，打开客服并附带当前方案/项目卡片。页面不再自行拼接客服上下文或维护 `watch` / 卸载清理。

---

## 环境变量

- 在 `types/env.d.ts` 中声明类型（`ImportMetaEnv`），新增变量必须在此文件补类型。
- 变量必须以 `VITE_` 前缀开头，客户端代码通过 `import.meta.env.VITE_*` 访问。
- 当前已声明：`VITE_APP_TITLE`、`VITE_API_BASE_URL`、`VITE_LINGTONG_API_URL`。

---

## 构建产物说明

生产构建使用 Terser 压缩，**会自动删除** `console.log` 和 `console.info`，调试日志只在开发模式有效。chunk 分割策略已固定（`vue-core` / `vue-use` / `radix` / `vendors`），不要随意修改 `manualChunks`。
