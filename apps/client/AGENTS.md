# AGENTS.md — apps/client（参展商前端）

参展商公众端。Vue 3.5 + Vite 6 + Tailwind CSS 3 + Shadcn-Vue（Radix Vue）。
命令见根目录 `AGENTS.md`；此文件仅补充 client 专属内容。

## 注意事项

- **无独立 lint / test 脚本**；类型验证唯一入口是 `pnpm build`（内含 `vue-tsc --noEmit`）。
- 额外脚本：`pnpm build:prod`（等同 `pnpm build --mode production`，显式指定生产模式）。
- **无后端 proxy**，vite.config.ts 未配置 proxy；API 地址由 `VITE_` 环境变量控制。

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

---

## 环境变量

- 在 `types/env.d.ts` 中声明类型（`ImportMetaEnv`），新增变量必须在此文件补类型。
- 变量必须以 `VITE_` 前缀开头，客户端代码通过 `import.meta.env.VITE_*` 访问。
- 当前已声明：`VITE_APP_TITLE`。

---

## 构建产物说明

生产构建使用 Terser 压缩，**会自动删除** `console.log` 和 `console.info`，调试日志只在开发模式有效。chunk 分割策略已固定（`vue-core` / `vue-use` / `radix` / `vendors`），不要随意修改 `manualChunks`。
