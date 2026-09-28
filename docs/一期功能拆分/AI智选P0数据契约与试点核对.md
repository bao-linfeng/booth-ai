# AI 智选 P0 数据契约与试点核对

日期：2026-09-28。本文记录本轮落地的字段与字典边界；方案发布和试点资产须以实际对象、清单和审核记录验收。

## 字段映射

| 原方案字段/API | 当前 API | 当前存储 | 规则 |
|---|---|---|---|
| `lengthCm`/`widthCm`/`heightCm` | `lengthMm`/`widthMm`/`heightMm` | `length_mm`/`width_mm`/`height_mm` | 旧厘米乘 10，必须精确为正整数毫米，迁移失败即停止 |
| `areaSqm` | `areaM2` | `area_sqm` | PostgreSQL decimal 原精度保留；后台读取为十进制字符串、写入为数字；录入长宽后按整数毫米派生，导入面积不一致时报错 |
| `openingCount` | `openingCount` | `opening_count` | 仅按开口面数判定；不维护方向字段 |
| `productLine` | `productSystemId` | `product_system_id` | UUID，关联通用字典 `product_system` |
| `style` | `styleId` | `style_id` | UUID，关联通用字典 `style` |
| `industries` | `industryIds` | `industry_ids` | 保留现存多行业，不折叠成单值；UUID 数组 |
| `budgetTier` | `budgetTierId` | `budget_tier_id` | UUID，关联通用字典 `budget_tier` |
| `functionalZones`/`keyFeatures` | `zoneIds`/`featureIds` | `zone_ids`/`feature_ids` | UUID 数组，分别关联 `functional_zone`/`key_feature`，同一标签可属于不同字典 |
| `revision` | `editRevision` | `revision` | 方案乐观锁及审核依据，不改变资产自身 `revision` |

统一使用管理端通用 `dictionaries`/`dictionary_items` 表及其管理页面。`item_value` 是稳定业务码，`id` 是方案/选型传输的稳定 UUID，显示用 `item_label`。停用项不接受新写入，不在公开选项中出现；已引用项不得删除。业务词“弧形”和“弧形元素”分为两个 ID，暂不合并同义词；未来增加别名时必须确认歧义和冲突。`catalog_options_legacy` 仅保存旧表以便核对，不参与读写。

迁移先核对每条历史尺寸是否可精确换算、所有字符串值是否有唯一匹配的字典项，面积也受长宽一致性约束；失败则事务回滚。可用 `SELECT DISTINCT product_line, style, budget_tier FROM schemes` 及 `unnest(industries/functional_zones/key_features)` 列出待人工核对旧标签，补字典后重跑。提供的 JSON 下拉选项作为 `product_system` 六项、风格十一项、行业十二项、预算三项的种子，分区/特征按存量原词独立录入。历史多行业按原顺序转成 ID 数组，不推断额外结构条件。导入预览把中文标签映射到已启用字典项；无法映射或尺寸精度有误的行报错，不生成可发布方案。该 JSON 自述核验状态不生成任何审核或已核验清单记录。

## 发布与资产

资产 `scheme_assets.id` 是逻辑 `assetId`；替换上传追加 `asset_versions`，当前版本按创建时间/id 取最新，历史版本不可改写。已发布方案的资产新增、修改、替换或失效会在同一数据库事务下撤回发布、递增方案修订并重置核验；原审核仅针对当时修订。整体审核通过需逐项确认资产齐全、BOM 核验、三图蒙版配对及三视图。候选读取继续要求已发布、当前修订审核通过、清单核验通过、六类资产齐全、恰好三张 16:9 效果图及对应蒙版。未核实对象仍不能发布。

## 试点资产清单与验收边界

2026-09-28 本地库核对：45 套草稿，7 条资产版本（4 效果图、1 蒙版、1 三视图、1 平面素材），0 条审核，0 条已核验清单；没有具备发布门槛的方案。`docs/灵通展台方案打标.json` 的方案属性不是图片、模型及清单文件。I02 所需十套完整资产无法由这批文本推导。

准备十套试点方案时，每套需有经过确认的长宽高、开口面数、通用字典标签、适用条件及标签确认、模型、已核验 BOM 清单、三张不同的 16:9 效果图和各自尺寸匹配的蒙版、三视图、平面素材、当前修订整体审核记录。通过后台逐套查看 readiness 并由授权操作员审核、发布；再从匿名公共条件、匹配、详情复验，实际返回的数量与选型判定须如实记录。未获得真实文件及审核证据前不勾选 I02/S16。

## 实施与恢复

`012_selection_dictionary_units.sql` 只能追加执行，迁移脚本有 checksum；正式执行前备份数据库及 S3 对象，先在数据副本演练。迁移保留 `scheme_selection_migration_backup` 与 `catalog_options_legacy` 供逐条比对；迁移在单一事务内失败时回滚。已提交的迁移不能直接倒改：如需恢复生产数据库，停写并从迁移前一致性备份恢复（同时核对迁移后写入的方案及对象）；需继续向前修正则追加新迁移。

API 成功响应统一 `{code:0,data}`；管理方案更新 `PUT /api/v1/admin/schemes/:code` 必须提交 `editRevision`，公开选型沿用 `/api/v1/client/catalog/options`、`/scheme-matches` 与 `/schemes/:code`。管理员选项通过 `/api/v1/admin/schemes/options` 读取通用字典。错误沿用平台标准错误包装。尚未冻结的业务规则与权限角色验收见 [开发清单](AI智选模块开发清单.md) F06/F07、I03。
