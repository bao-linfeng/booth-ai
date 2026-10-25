# 计划：移除低价值模块的 expectedRevision 乐观并发检查

## 背景

`expectedRevision` 乐观并发控制目前用在了 18 个模块。对于报价、项目状态流转这类多人可能同时编辑的场景，它能有效防止丢失更新。但对于 **单行全局设置** 和 **低频管理配置**，在当前 3 个管理员的规模下，并发冲突概率极低，`expectedRevision` 只增加了前后端的传参复杂度。

## 范围

### 移除 expectedRevision 的 5 个模块

| # | 模块 | 服务端文件 | 路由文件 | 前端组件 / API |
|---|------|-----------|----------|---------------|
| 1 | 客服设置 | `modules/customer-service/settings.ts` | `http/admin/customer-service/schema.ts` | `api/core/customer-service.ts`、`views/customer-service/settings/index.vue` |
| 2 | 主题生成设置 | `modules/generation/theme/settings.ts` | `http/admin/ai-models/index.ts` (L419-436) | `api/core/ai-models.ts`、`views/ai-models/components/ThemeSettingsPanel.vue` |
| 3 | 画稿生成设置 | `modules/generation/artwork/settings.ts` | `http/admin/ai-models/index.ts` (L447-464) | `api/core/ai-models.ts`、`views/ai-models/components/ArtworkSettingsPanel.vue` |
| 4 | AI 供应商 | `modules/ai-models/providers.ts` | `http/admin/ai-models/index.ts` (L235-255) | `api/core/ai-models.ts`、`views/ai-models/components/ProviderFormModal.vue` |
| 5 | AI 模型 | `modules/ai-models/models.ts` | `http/admin/ai-models/index.ts` (L331-350) | `api/core/ai-models.ts`、`views/ai-models/components/ModelFormModal.vue` |

### 不动的

- **`asset_upload_requests` 幂等表**：与 expectedRevision 无关，是上传幂等防重机制，移除会导致网络重试创建重复资源。优先级低，暂不动。
- **提示词模板**：模板 body 较长，覆盖丢失的修复成本高于设置项，暂时保留。
- 项目、方案、资产、BOM、角色、主题选择、项目分配等 7 个多人并发模块：必须保留。

---

## 每个模块的具体改动

### 1. 客服设置

**服务端 `src/modules/customer-service/settings.ts`**

- `CsSettingsInput` 接口：删除 `expectedRevision: number` 字段
- `updateSettings` 函数（L107-125）：删除 `if (before.revision !== input.expectedRevision) throw csError(...)` 检查（L109）
- 保留 `FOR UPDATE` 行锁（防止同一事务内 race），保留 `revision = revision + 1`

**路由 schema `src/http/admin/customer-service/schema.ts`**

- `putSettingsSchema.body.required`（L229）：从数组中移除 `'expectedRevision'`
- `putSettingsSchema.body.properties`（L235）：删除 `expectedRevision` 属性定义
- 更新 summary（L225）：去掉「（乐观锁）」

**前端 `apps/admin`**

- `api/core/customer-service.ts`（L318）：从 `saveCsSettings` 入参类型中删除 `expectedRevision`
- `views/customer-service/settings/index.vue`（L138）：调用 `saveCsSettingsApi` 时不再传 `expectedRevision: settings.value.revision`
- 同文件 409 冲突处理（L147-150）：该 catch 分支可保留（其他原因也可能 409）或简化

**测试**

- `tests/integration/customer-service-integration.test.ts`（L670-683）：
  - L671-674：调用 `updateSettings` 时删除 `expectedRevision` 参数
  - L676-683：**删除** stale revision 的 `assert.rejects` 测试（该行为不再存在）
- `tests/integration/customer-service-integration.test.ts`（L878-881）：
  - L880：HTTP 路由测试中删除 `expectedRevision` 字段
- `tests/integration/cs-emails.test.ts`（L184）：删除 `expectedRevision: settings.revision`

### 2. 主题生成设置

**服务端 `src/modules/generation/theme/settings.ts`**

- `updateThemeGenerationSettings` 函数签名（L42）：入参类型从 `ThemePipelineOptions & { expectedRevision: number }` 改为 `ThemePipelineOptions`
- 删除 revision 检查（L51-52）

**路由 `src/http/admin/ai-models/index.ts`**

- PUT `/theme-generation-settings` 的 body schema（L429）：`required` 数组移除 `'expectedRevision'`，`properties` 移除 `expectedRevision: revision`

**前端**

- `api/core/ai-models.ts`（L209）：`saveThemeGenerationSettingsApi` 入参类型删除 `expectedRevision`
- `views/ai-models/components/ThemeSettingsPanel.vue`（L77）：调用时删除 `expectedRevision: saved.value.revision`

**测试**

- `tests/integration/theme-settings-integration.test.ts`：
  - L39：`updateThemeGenerationSettings(pool, { ...input, expectedRevision: 1 }, admin)` → 删除 `expectedRevision: 1`
  - L44-47：**删除** stale revision 的 `assert.rejects` 断言

### 3. 画稿生成设置

**服务端 `src/modules/generation/artwork/settings.ts`**

- `updateArtworkGenerationSettings` 函数签名（L44）：入参类型删除 `{ expectedRevision: number }`
- 删除 revision 检查（L53-54）

**路由 `src/http/admin/ai-models/index.ts`**

- PUT `/artwork-generation-settings` 的 body schema（L457）：`required` 数组移除 `'expectedRevision'`，`properties` 移除 `expectedRevision: revision`

**前端**

- `api/core/ai-models.ts`（L240）：入参类型删除 `expectedRevision`
- `views/ai-models/components/ArtworkSettingsPanel.vue`（L88）：调用时删除 `expectedRevision`

**测试**

- `tests/integration/artwork-settings-integration.test.ts`：
  - L104：删除 `expectedRevision: 1`
  - L111-118：**删除** stale revision 的 `assert.rejects` 断言
  - L130：删除 `expectedRevision: 2`

### 4. AI 供应商

**服务端 `src/modules/ai-models/providers.ts`**

- `ProviderUpdate` 接口（L125-131）：删除 `expectedRevision: number`
- `updateProvider` 函数（L133-176）：
  - 删除 revision 检查（L144）
  - 审计日志 detail 中的 `expectedRevision`（L171）也删除

**路由 `src/http/admin/ai-models/index.ts`**

- PUT `/ai-providers/:id` 的 body schema（L245-246）：`required` 移除 `'expectedRevision'`，`properties` 移除 `expectedRevision: revision`

**前端**

- `api/core/ai-models.ts`（L123）：`updateAiProviderApi` 入参类型删除 `expectedRevision`
- `views/ai-models/components/ProviderFormModal.vue`（L116）：调用时删除 `expectedRevision: target.revision`

**测试**

- `tests/unit/ai-models.test.ts`：
  - L137：`update` 对象删除 `expectedRevision: 4`
  - L146：删除 `expectedRevision: 3` 的 stale revision 测试
  - L134 测试标题：去掉 `with optimistic revisions`
- `tests/integration/ai-models-integration.test.ts`（L162）：删除 `expectedRevision: 1`
- `tests/http/admin-ai-models.test.ts`（L50）：模型更新场景里 `{ expectedRevision: 1 }` 已不需要（但此处是模型不是供应商，见下方第 5 项）

### 5. AI 模型

**服务端 `src/modules/ai-models/models.ts`**

- `ModelUpdate` 接口（L65-70）：删除 `expectedRevision: number`
- `updateModel` 函数（L72-100）：
  - 删除 revision 检查（L82）
  - 审计日志 detail 中的 `expectedRevision`（L97）也删除

**路由 `src/http/admin/ai-models/index.ts`**

- PUT `/ai-models/:id` 的 body schema（L341-342）：`required` 移除 `'expectedRevision'`，`properties` 移除 `expectedRevision: revision`

**前端**

- `api/core/ai-models.ts`（L162）：`updateAiModelApi` 入参类型删除 `expectedRevision`
- `views/ai-models/components/ModelFormModal.vue`（L170）：调用时删除 `expectedRevision: target.revision`

**测试**

- `tests/http/admin-ai-models.test.ts`（L50）：PUT 分支不再传 `expectedRevision: 1`
- `tests/integration/ai-models-integration.test.ts`：
  - L148：删除 `expectedRevision: 1`
  - L153：**删除** stale revision 409 的 `assert.rejects`

---

## 不需要改的

- **数据库**：不需要迁移。所有表的 `revision` 列保留，`revision = revision + 1` 在 UPDATE 语句中保留——这是零成本的审计信号，对 `refreshProviderCatalog` 等内部使用也有价值。
- **`FOR UPDATE` 行锁**：保留，防止同一事务内的 race condition。
- **前端 `api/reason-messages.ts`**：`REVISION_CONFLICT` 映射保留（其他模块仍在用）。

---

## 实施顺序

1. **第一批**（3 个单行设置，改动最少，互不依赖）：客服设置、主题生成设置、画稿生成设置
2. **第二批**（2 个 AI 管理）：AI 供应商、AI 模型
3. **验证**：Docker check 全部通过（类型检查 + 测试 + 构建），admin `typecheck` + `test:antd` 通过

---

## 风险评估

- **数据丢失风险**：极低。这些设置的特点是（1）写入低频（2）操作人少（3）覆盖丢失后重新设置的成本几乎为零
- **兼容性**：`expectedRevision` 从 required 变为不存在，旧前端传了多余字段会被 `additionalProperties: false` 拒绝——但前后端同步部署，不存在灰度问题
- **回滚**：如果将来管理员增加到需要并发控制的规模，可以重新加回（数据库 revision 列一直在）
