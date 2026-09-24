# AGENTS.md — apps/admin

> 基础命令见根目录 `AGENTS.md` → "管理后台 `apps/admin`" 章节。本文件只补充根目录未覆盖的细节。

---

## 包结构

```
apps/admin/
├── apps/
│   ├── web-antd/          # @vben/web-antd — 主 UI（Ant Design Vue 4）
│   └── backend-mock/      # @vben/backend-mock — Nitro mock API（port 5320）
├── packages/@core/
│   ├── base/              # design tokens、icons、shared utils、typings
│   ├── composables/       # layout & app-state composables
│   ├── preferences/       # 偏好设置 store & 布局定制引擎
│   └── ui-kit/            # form-ui、layout-ui、menu-ui、popup-ui、shadcn-ui、tabs-ui
├── packages/effects/
│   ├── access/            # 路由 & 按钮级权限守卫
│   ├── hooks/             # 可复用 UI & 业务 hooks
│   ├── layouts/           # basic.vue、auth.vue 布局实现
│   ├── plugins/           # tippy、motion、vxe-table 集成
│   └── request/           # axios 封装（token 刷新 & 拦截器）
├── packages/
│   ├── stores/            # Pinia stores：auth、access、tabbar、user
│   ├── locales/           # vue-i18n（zh-CN、en-US）
│   └── utils/             # 通用工具函数
└── internal/
    ├── lint-configs/      # eslint、oxlint、oxfmt、stylelint、commitlint 配置
    ├── vite-config/       # 共享 Vite config 工厂
    └── tsconfig/          # 共享 TS base 配置
```

---

## 架构要点

- **路径别名**：`apps/web-antd` 用 `#/*` → `./src/*`。跨包引用用 workspace 包名或 `#adapter/form`、`#api/*`、`#views/*`，**禁止**跨包边界使用相对路径。
- **API 代理**：dev 模式下 `/api` → `http://localhost:5320/api`（Nitro mock）。切换真实后端改 `.env.development` 的 `VITE_NITRO_MOCK=false`。
- **Pinia stores** 在 `packages/stores`，不与组件同置。
- **权限控制** 在 `packages/effects/access`，路由守卫和按钮级检查都在这里。
- **依赖版本**：统一用 `pnpm-workspace.yaml` 的 `catalog:` 管理，新增依赖用 catalog 引用，不写裸版本字符串。

---

## 内部包 stub 构建

`pnpm install` 的 `postinstall` 会自动跑 `pnpm -r run --if-present stub`，用 `tsdown` 编译所有内部 workspace 包。  
修改 `internal/` 或 `packages/@core/` 下的包后，需在该包内跑 `pnpm stub` 或在 admin 根重跑 `pnpm install`，否则改动不生效。

---

## 预提交钩子（lefthook）

顺序：`oxlint` → `oxfmt` → `eslint` → `stylelint` → `checkType`，开启 `stage_fixed: true`。  
提交被拒时修复错误后直接重试，钩子会自动 stage 已修复的文件。

---

## Turbo 流水线

- `build` 依赖 `^build`（上游包优先构建）。
- `dev` 为 `cache: false, persistent: true`。
- `typecheck` 不产出文件，仅做类型检查。
- 全量构建约需 8 GB 堆内存，根 `build` 脚本已自动设置 `NODE_OPTIONS`。
