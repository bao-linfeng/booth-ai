# 方案资产边界

`scheme_assets` 保留统一的逻辑资产 ID，`asset_versions` 保留素材版本。来源、归属和可见范围由显式字段表达，metadata 仅保存描述性信息。

| 来源 source | 归属 owner_user_id | visibility | 用途 |
|---|---|---|---|
| `scheme` | NULL | `public` | 管理端维护的公共方案基线 |
| `theme_generation` | 生成任务用户 | `private` | 用户换主题结果 |
| `artwork_generation` | 生成任务用户 | `private` | 用户四面平面素材结果 |

数据库约束禁止生成结果标记为公共，禁止公共基线绑定用户。新生成结果写入时必须同时写入来源、用户归属和私有范围；客户端读取结果、缓存复用和绑定询价素材同时校验任务用户与资产归属。

## 统一公共基线

`scheme_baseline_assets` 是公共基线规则的唯一数据库入口：`source = 'scheme' AND visibility = 'public' AND owner_user_id IS NULL`。视图支持写入，并以 CHECK OPTION 保证管理端写入仍符合基线规则。

发布就绪、选型、公开下载、询价快照、换主题输入、管理端资产管理和 BOM 来源写入均使用该视图。活跃状态和版本就绪条件由具体业务查询判断；选型的审核后变更检查保留对已停用基线资产的检查。公开下载仍要求方案已发布。

用户素材通过任务结果关联和用户归属读取，不进入公共基线计数和审核后变更判断。已绑定项目按项目权限读取固定版本，不按当前公共可见范围重新筛选。

## 历史迁移

`050_asset_scope.sql` 优先从主题/画稿任务结果关联回填，再处理仅有旧 metadata 标记的素材。主题缓存的同用户重复引用保留同一资产归属；多用户冲突或任务已缺失的生成素材保留私有范围，归属为 NULL，不向公众暴露。旧标记中的无效任务 ID 不会导致 UUID 转换失败。

迁移不修改资产 ID、修订、时间戳、素材版本、项目 JSON 快照或 `project_asset_versions` 引用。历史项目仍可通过原版本交付。迁移应先于新版 API/Worker 启动执行。

## 验证

`tests/asset-scope-integration.test.ts` 使用 `ASSET_TEST_DATABASE_URL`，在隔离 schema 中执行迁移并验证回填、历史引用完整性、发布/选型/下载/快照一致性及管理端隔离。主题缓存、生成恢复和四面素材集成测试覆盖新生成结果写入与私有素材交付。
