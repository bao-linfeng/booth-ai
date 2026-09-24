# Booth AI 服务端

Fastify 5 + BullMQ 6 + Redis 7.4 + PostgreSQL 17 + Silo，Node.js 24 / TypeScript。

从仓库根运行 `./scripts/setup.ps1`，不需要在宿主机安装 Node.js 或 npm。完整 Docker 命令、端口和运行约定见 [本地开发文档](../../docs/服务端本地开发.md)。

## 目录与边界

```text
src/
  api.ts                 HTTP 进程入口、连接生命周期
  app.ts                 Fastify 工厂、健康检查、错误、CORS、OpenAPI
  worker.ts              Worker 与 Outbox 投递循环
  config.ts              环境变量校验
  infra/                 PostgreSQL、Redis、BullMQ、S3 适配
  modules/tasks/         内部示例任务与事务 Outbox
  scripts/               迁移、私有桶初始化、集成 smoke
migrations/              有校验和的有序 SQL 迁移
tests/                   HTTP、异常、配置测试
```

业务模块后续按领域放入 `src/modules/<domain>`，路由分别注册到 `/api/v1/client`、`/api/v1/admin`、`/api/v1/su`，共享 service/repository，不能仅凭路径判断权限。当前这些业务路由尚未实现。已有外部账户系统继续复用，不新增本地密码认证或猜测 JWT 校验方式。

## 异步任务约定

当前仅有内部 `system.echo` 任务，用来验证真实数据库、Redis 和 Worker 链路，无公开任务提交接口。`foundation_tasks` 与 `foundation_outbox` 不作为最终 AI 业务表。

任务与 Outbox 在同一事务中提交。投递器使用 `FOR UPDATE SKIP LOCKED` 与稳定 `jobId`，消费端再次检查数据库完成状态。队列投递与处理允许重复，不承诺 exactly-once。任务记录保留在 PostgreSQL，队列历史有时间和数量上限。示例失败最多重试 3 次，最终错误落库。

后续业务请求的幂等键必须包含用户/租户和操作范围，并验证重复请求的输入一致。AI 外部调用不能直接照搬示例的数据库事务锁；需要持久化阶段、供应商幂等键或结果对账机制，积分扣减使用唯一业务流水。不要在持有数据库行锁期间等待长时间生成。

队列 Redis 使用 AOF + `noeviction`。数据库 Outbox 可恢复未投递事件；已投递后发生 Redis 灾难性数据丢失的任务，需要后续业务对账重投机制，当前基础示例未实现。生产容量规划时将可淘汰缓存与队列 Redis 分实例。

## 配置与存储

配置缺失或格式错误会阻止启动；错误不会输出配置值。请求日志仅记录方法、路由模板、状态码和 requestId，不记录请求体、查询字符串、凭据或上游原始错误。

对象存储桶默认私有。`S3_ENDPOINT` 用于容器内访问，`S3_PUBLIC_ENDPOINT` 用于浏览器可达的签名地址；不能把容器内部主机名返回给浏览器。`signDownload` 只是底层能力，调用方必须先执行业务授权。开发中 API 与 Worker 共享本地 Silo 凭据；生产应配置独立最小权限服务账号。

修改数据库通过新增 migration；已执行文件不可修改，校验和不一致会使迁移失败。迁移只执行 DDL，不自动配置业务账户和权限。

生产镜像目标为 `runtime`，API 默认 `node dist/api.js`，Worker 为 `node dist/worker.js`。运行迁移用 `node dist/scripts/migrate.js`，初始化桶用 `node dist/scripts/storage-init.js`。Compose 文件用于本地开发，不是生产部署配置。
