# 生成设置是否应写死为代码常量

## 背景

换主题的蒙版（sendMask）、合成（composite）、背景模式（backgroundMode/backgroundColor），四向图的方向（drawingDirections）、灰度（drawingGrayscale）、并发（directionConcurrency），目前作为线上可配置项存在于两张单行表（`theme_generation_settings`、`artwork_generation_settings`），带版本号冲突检测、审计日志和旧快照兼容。如果 A/B 结论已定，是否应简化成代码常量？

## 分析

### 1. 这不是 A/B 实验基础设施 — 它是运维调参面板

代码实际上非常精简，没有过度工程化：

- **两张单行表**（`theme_generation_settings`、`artwork_generation_settings`），各自用 `CHECK (id = TRUE)` 保证全局唯一行
- **版本号冲突检测**：就是标准的 `revision` 乐观锁，总共 3 行逻辑（`settings.ts:51-52`），防止两个管理员同时改冲突。这不是"A/B 实验的冲突检测"，而是任何可编辑配置都该有的并发保护
- **审计日志**：复用已有的 `writeAuditLog` 基础设施，只有 2 行调用。这是管理后台改任何东西都有的标配
- **旧快照兼容**：就是 `LEGACY_THEME_OPTIONS` 一个常量（`settings.ts:19-24`），用来处理引入设置表之前提交的历史任务。这是数据兼容，不是"实验框架"

两个 settings 文件加起来 **142 行**（含类型定义和注释），不算臃肿。

### 2. 这些参数有实际的运维调节需求

从迁移注释和代码语义来看：

| 参数 | 写死的风险 |
|------|-----------|
| `sendMask` | 蒙版是否发给供应商 — 供应商支持度变化、效果不达预期时需要快速关闭 |
| `composite` | 合成开关 — 影响出图质量，可能按供应商表现随时调整 |
| `backgroundMode` | 透明 vs 铺色 — 取决于主流供应商对透明通道的处理能力 |
| `drawingDirections` | 哪些方向附报馆图 — 报馆图质量不够时可能需要临时去掉某个方向 |
| `drawingGrayscale` | 灰度开关 — 取决于实际出图是否带入旧配色 |
| `directionConcurrency` | 并发数 — 直接影响供应商 rate limit 和成本，需要随供应商配额调整 |

这些都不是"实验结论定了就不变"的参数。它们是**生产运维旋钮**——供应商能力、费率、配额变化时，运维人员需要不重新部署就能调整。

### 3. 快照冻结是核心设计，不是实验残留

任务提交时把当前设置冻结进 `generation_snapshot`，worker 只读快照。这个设计保证了：
- 改设置不影响正在跑的任务
- 任务回溯时能看到当时用的参数

这是正确的生产级设计，不是实验遗留。`directionConcurrency` 明确标注不冻结（`085_artwork_direction_concurrency.sql:2`），因为它只影响执行速度不影响出图——说明设计者对哪些该冻结、哪些不该冻结有清晰的判断。

## 结论

**不建议改成代码常量。** 当前实现复杂度很低（两张单行表 + 两个 ~70 行的 settings 文件 + 管理端两个面板），但提供了：

- 不停机调参
- 并发保护
- 变更审计
- 快照隔离

如果真的有某个参数已经 100% 确定永远不会再变（比如 `backgroundMode` 从此就只用 `fill`），那可以把它从 settings 表移除、在代码里写死，同时写一个迁移把列删掉。但建议**逐个评估**，而不是整体推倒。
