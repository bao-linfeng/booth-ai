# AGENTS.md — apps/admin（Vben Admin 5 管理后台）

这是独立于仓库根目录的 pnpm + Turborepo monorepo。**所有命令必须在 `apps/admin/` 下执行，不要从仓库根目录调用。**

跨项目信息（环境初始化、端口、前后端契约、全局约定）见根目录 [`AGENTS.md`](../../AGENTS.md)；此文件仅记录 admin 专属内容。

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
pnpm test:antd             # 只跑 web-antd 业务测试（apps/web-antd/src 下的 *.test.ts）
pnpm test:unit             # vitest run --dom（全部包，含框架层）
pnpm vitest run --dom <path/to/test.ts>  # 单文件

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

### 偏好配置

- 应用覆写入口：`apps/web-antd/src/preferences.ts`（`defineOverridesPreferences` 只传需要修改的字段，其余沿用框架默认；改后需清缓存才生效）。项目自定义偏好项通过同文件的 `definePreferencesExtension` 扩展。
- 全部字段及中文说明见类型定义 `packages/@core/preferences/src/types.ts`（`Preferences` 及 `AppPreferences`、`ThemePreferences` 等子接口），默认值见同目录 `config.ts`。不要在文档中另行维护字段表。

### 包引用别名

- `#/*` → `./src/*`（仅在 web-antd 内有效，见 package.json `imports`）
- `@vben/*` → workspace 包，不要直接改 `packages/` 里的核心代码，除非明确在修改框架层

### HTTP 请求

- `requestClient`（`src/api/request.ts`）：自动注入 `Authorization: Bearer <token>` + 语言头；响应拦截期望 `{ code: 0, data: ... }` 格式
- `baseRequestClient`：无拦截器的裸客户端，用于不需要鉴权的请求
- **不支持 refresh token**（`doRefreshToken` 直接 reject），token 过期直接跳登录页

### 业务页面组件规范（检索 / 列表 / 表单 / 弹窗）

后续管理模块以 `apps/web-antd/src/views/scheme/list/` 的组合方式为参考：**Schema 描述检索和表单，columns 描述列表，插槽定制展示，API 控制交互**。框架负责通用 UI、表单状态与表格交互；业务代码负责字段定义、接口调用、数据转换和业务联动。

以下路径均相对于 `apps/web-antd/src/`。参考页面用于理解组件组合方式；新代码仍须遵循 TypeScript 严格类型约定，不照搬其中的 `any` 或旧字段兼容写法。

#### 组件选用

| 场景 | 默认选用 | 导入位置 / 说明 |
| --- | --- | --- |
| 页面容器 | `Page` | `@vben/common-ui`；自适应高度列表页使用 `auto-content-height` |
| 主业务列表 | `useVbenVxeGrid` | `#/adapter/vxe-table` |
| 列表检索区 | Grid 的 `formOptions` | 复用 Vben Form，不单独手写重复的查询/重置逻辑 |
| 新建 / 编辑表单 | `useVbenForm` | `#/adapter/form` |
| 业务弹窗 | `useVbenModal` | `@vben/common-ui` |
| 按钮、标签、提示、上传等基础 UI | Ant Design Vue 组件 | `ant-design-vue` |
| 简单删除确认 | `Modal.confirm` | `ant-design-vue` |
| 弹窗内轻量预览 / 结果表格 | 可直接使用 Ant Design Vue `Table` | 例如导入预览；需要完整检索、远程分页等能力时复用 Vben Grid |

业务表单和主列表统一从项目 `adapter` 导入，不绕过适配层直接使用底层表单实例或自行重复封装通用 CRUD 框架。

#### 检索与主列表

- 使用 `useVbenVxeGrid({ formOptions, gridOptions })` 返回的 `[Grid, gridApi]` 组合检索和列表。
- 检索字段定义在 `formOptions.schema` 中：`component` 指定控件，`fieldName` 指定表单字段，`label` 指定标题，`componentProps` 传递控件属性。需要折叠时配置 `showCollapseButton`。
- 动态字典选项通过 `gridApi.formApi.updateSchema()` 更新；有接口转换要求时，在查询函数中显式转换表单值。
- 普通列通过 `gridOptions.columns` 定义 `field`、`title`、宽度等；状态标签、组合字段、操作按钮通过 `slots` 和模板中的同名插槽实现。
- 页面级按钮放在 `toolbar-actions` 插槽；行级操作放在操作列插槽，需要时将操作列固定在右侧。
- 远程数据查询统一使用 `proxyConfig.ajax.query`。将分页参数与检索条件组装后调用 API，返回 `{ items, total }`，与适配层的响应字段映射一致。
- 使用 `pagerConfig` 配置分页，按页面需求配置工具栏刷新、自定义列、最大化和溢出提示，不手写框架已有的通用能力。
- 新增、编辑、删除、导入成功后，由列表页统一调用 `gridApi.reload()` 刷新。
- 为列表行、检索值、接口入参提供明确类型，优先使用适配层导出的配置类型及 API 类型，避免 `any`。

#### 新建 / 编辑表单

- 同一业务的新建与编辑优先复用一个表单组件，通过当前操作模式决定初始化与提交行为。
- 使用 `useVbenForm({ schema, handleSubmit, ... })` 返回的 `[Form, formApi]`；字段通过 Schema 声明，避免逐项手写重复的表单绑定、校验和布局。
- `rules` 声明校验规则；通用必填规则复用适配层的 `required` / `selectRequired`，业务特有规则按实际需求配置。
- 使用 `wrapperClass`、`formItemClass` 控制栅格布局；多选、标签输入等通过底层组件的 `componentProps` 配置。
- 字段联动使用 `dependencies.triggerFields` 和 `dependencies.trigger`，由业务逻辑计算并通过 `formApi.setValues()` 更新关联字段。
- 表单初始化和回填使用 `resetForm()`、`setValues()`；动态选项、禁用状态等使用 `updateSchema()`。复用组件时须重置上一次操作的值和动态状态。
- 编辑需要完整记录时，先请求详情再回填，不假定列表行包含全部可编辑字段。
- 在 `handleSubmit` 中显式构造创建 / 更新入参；涉及版本校验的接口应保存详情版本并按契约提交，如 `expectedRevision`。

#### 弹窗与父子组件协作

- 使用 `useVbenModal()` 返回的 `[Modal, modalApi]` 管理业务弹窗，以 `open()`、`close()`、`setState()` 控制显示、标题和提交状态。
- 弹窗承载表单时，设置 `showDefaultActions: false`，由弹窗确认事件调用 `formApi.validateAndSubmitForm()`，避免重复显示提交按钮或绕过校验。
- 异步提交期间设置 `confirmLoading`，在 `finally` 中恢复；成功后提示、通知父页面刷新并关闭弹窗，失败时保留表单以便修正或重试。
- 采用方案列表的拆分方式时，子组件通过 `defineExpose({ open })` 暴露入口，父页面通过类型化组件 `ref` 调用 `open()` / `open(record)`；子组件通过 `reload` 事件通知父页面刷新，不直接耦合父页面的 Grid 实例。
- 只读详情可使用禁用字段的 Vben Form，并通过 `footer: false` 隐藏操作区；纯展示内容也可按需求使用 `Descriptions`。只有字段定义确实复用时才提取共享 Schema，不提前建立抽象层。
- 导入等多步骤流程使用明确的步骤状态控制内容和确认行为，外层复用 Vben Modal，内部组合 Upload、Table、Descriptions 等基础组件。

#### 适配层职责

- `adapter/component/index.ts`：注册 Schema 中组件名与实际 UI 组件的映射。
- `adapter/form.ts`：维护双向绑定属性映射、通用校验规则以及表单类型适配。
- `adapter/vxe-table.ts`：维护表格全局默认值、响应字段映射、通用渲染器，并接入 `useVbenForm`。
- 当前已全局关闭 VXE 自带的 `formConfig`，检索统一使用 `formOptions`；业务页面不要另行启用第二套检索表单。
- 页面特有配置留在业务模块；只有确实跨模块共享的行为才放入适配层，不因单页需求修改框架核心 `packages/`。

#### 建议目录与参考入口

按实际复杂度组织，简单页面无需机械拆分：

```text
views/<module>/list/
├── index.vue                   # 页面组装、工具栏、列插槽、刷新协调
├── options.ts                  # 检索 Schema、表格列、查询代理配置
└── components/
    ├── <Module>FormModal.vue    # 新建 / 编辑表单及提交逻辑
    ├── <Module>DetailModal.vue  # 详情（有需要时）
    └── <Module>ImportModal.vue  # 导入（有需要时）
```

接口请求及入参 / 返回类型放在 `api/` 对应业务模块，页面不直接拼接 HTTP 请求。

参考：`views/scheme/list/index.vue`、`views/scheme/list/options.ts` 以及该目录下的 `components/SchemeFormModal.vue`、`SchemeDetailModal.vue`、`SchemeImportModal.vue`。

### 业务测试

- **检查流程**：改动 `apps/web-antd/src` 后依次跑 `pnpm -F @vben/web-antd run typecheck`、`pnpm test:antd`，两者都通过才算完成。
- 组件测试与被测组件同目录放在 `__tests__/`。Vben 表单/弹窗与 ant-design-vue 用替身隔离，业务逻辑（请求幂等键、`expectedRevision`、Schema `dependencies`、只读/权限守卫）保持真实；项目模块的替身见 `views/projects/__tests__/fake-vben.ts`。
- 组件新增 `useAccess`、store 等依赖时须同步更新其测试的 mock，否则测试会因缺少 Pinia 等运行环境直接失败。

### 环境变量（web-antd）

- `.env`：`VITE_APP_TITLE`、`VITE_APP_NAMESPACE`、`VITE_APP_STORE_SECURE_KEY`（**必须替换默认值**）
- `.env.development`：`VITE_PORT=5666`、`VITE_GLOB_API_URL=/api`（代理到后端）
- `.env.production`：`VITE_GLOB_API_URL` 改为真实 API 地址，`VITE_ROUTER_HISTORY=hash`
- Nitro mock（`VITE_NITRO_MOCK=true`）：开发时启用 backend-mock 作为接口服务

### 权限系统

- 权限来源为本系统服务端 `GET /api/v1/admin/access`，返回 `permissions`、`routeNames`、`homePath`；外部角色权限不参与授权。
- `router/guard.ts` 在导航时刷新权限，`router/authorized-routes.ts` 依据服务端路由名称白名单过滤菜单和路由。
- 按钮复用 `@vben/access` 的 `v-access:code` / `hasAccessByCodes`，权限码与服务端目录一致；业务接口仍由服务端强制鉴权。
- 授权弹窗用 `@vben/common-ui` 的 `Tree`（多选、父子联动）展示按真实路由（`accessRoutes`）生成的「一级菜单 → 二级页面 → 页面操作」树（`views/user/roles/permission-tree.ts`）；权限码仍是唯一数据源，Tree 选中键与权限码互转，依赖补齐/级联取消在弹窗的 `toggleCodes` 完成。页面与权限的对应以服务端目录的 `routes` 为准：新增页面时在服务端 `permissionGroups` 登记路由名；带 `meta.activePath` 的从属页不单列；没有页面的权限模块归入“其他”。
- “用户运营 → 用户角色”配置本地授权；角色 ID/名称来自灵通用户系统，所有角色（包括 `ROLE_ADMIN`）均可由拥有 `roles.write` 权限的用户编辑，实际权限以本地保存值为准。
- 权限树按每个权限项的 `routes` 映射实际页面，同一页面可包含多个权限分组；资源页面分别授权，模型操作挂在方案列表下。新增按钮需同步登记操作权限、页面控制与服务端鉴权，共享接口按资源类型或提交字段细分检查。

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
