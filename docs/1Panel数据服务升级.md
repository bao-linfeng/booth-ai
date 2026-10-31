# 1Panel 数据服务升级：PostgreSQL 换成 pgvector 镜像、Redis 升到 8

把线上 1Panel 的 PostgreSQL 与 Redis 升到和本地共用基础设施（`D:/baolf/infra`）、CI 相同的版本。**2026-10-31 已在线上执行完成**（PostgreSQL 容器 `1Panel-postgresql-PtfA`，新 Redis 容器 `1Panel-redis-aqlT`），本文留作记录和其他服务器参考。

| 组件 | 升级前 | 升级后 |
|------|--------|--------|
| PostgreSQL | 1Panel PostgreSQL 应用，镜像 `postgres:18.6-alpine`（不含 pgvector） | 同一个应用，镜像改为 `pgvector/pgvector:0.8.7-pg18`（PostgreSQL 18 + pgvector 0.8.7） |
| Redis | 1Panel Redis 应用 7.4.10 | 新装 1Panel Redis 应用 8.10.3 |

**做法说明**

- PostgreSQL 不新装应用，而是修改现有 PostgreSQL 应用的镜像。这样容器名、1Panel「数据库」页面的管理、计划任务里的数据库备份都保持不变，编排里的 `DATABASE_URL` 不用改。
- alpine（musl）与 Debian（glibc）的文本排序规则和数据文件属主 uid 都不同，不能直接换镜像复用旧数据目录。必须先导出，再用空目录重新初始化，然后导入。
- Redis 应用不支持从 7 直接升级到 8，所以新装一个 8.10.3 应用，再把 `REDIS_URL` 指过去。Redis 里只有队列、登录会话、报价缓存和客服在线状态；生成任务有数据库 outbox 可以补发。换实例的影响是**所有人需要重新登录**。

**操作约定**

- 所有命令都在 **1Panel → 终端**（宿主机 shell）里执行。SQL 要通过 `docker exec ... psql` 进入容器执行，不能直接在 shell 里输入。
- **一次只粘贴一个代码块。** 如果某行前面出现 `^[[200~`，说明这一行没有执行，要重新输入。
- 1Panel 终端闲置后会重新连接（出现新的 `Welcome ...` / `Last login`），之前设置的 `PG`、`ROOT`、`TS` 变量会丢失，需要重新设置后再执行。
- 双引号里不要出现 `!`，bash 会当成历史展开并报 `event not found`。
- 下面以当前线上值为例：PostgreSQL 容器 `1Panel-postgresql-PtfA`，数据目录 `/opt/1panel/apps/postgresql/postgresql/data`。以第 0 步的实际输出为准。

---

## 0. 检查现状（只读）

```bash
PG=1Panel-postgresql-PtfA
docker inspect $PG --format '{{.Config.Image}}'
docker inspect $PG --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
docker exec $PG psql -U booth -d booth -tAc "select version(); select name, default_version from pg_available_extensions where name='vector'; select extname from pg_extension;"
```

预期输出：镜像是 `postgres:18.6-alpine`，数据目录挂载到 `/var/lib/postgresql`，pgvector 查不到，已安装的扩展只有 `plpgsql`。

---

## 1. 提前准备（不影响线上，可以提前做）

### 1.1 预先拉取镜像

```bash
docker pull pgvector/pgvector:0.8.7-pg18
```

也可以在 **容器 → 镜像 → 拉取镜像** 里填同一个镜像名。这一步不是必须的，第 4 步保存时 1Panel 也会自动拉取；提前拉好可以减少停机时间。拉取失败时，检查 **容器 → 配置 → 镜像加速**。

### 1.2 新装 Redis 8.10.3

1. **应用商店 → Redis → 安装**：版本选 `8.10.3`，名称填 `redis8`，密码用 `openssl rand -hex 24` 生成，**不要勾选「端口外部访问」**，端口改为 `6380`（旧 Redis 已占用宿主机 6379；容器之间仍通过容器名的 6379 访问）。
2. **数据库 → Redis**，切换到 redis8 → **设置 → 持久化**：打开 `appendonly`，`appendfsync` 选 `everysec`，保存。
3. 在 redis8 的命令终端执行 `CONFIG GET appendonly`、`CONFIG GET maxmemory-policy`，应分别为 `yes`、`noeviction`。
4. 在 **容器** 列表里记下 redis8 的容器名（形如 `1Panel-redis-xxxx`）。

---

## 2. 维护窗口：停止应用并备份

预计停机 5～10 分钟，选没人使用的时间段。

### 2.1 确认没有任务在跑，然后停止应用

```bash
docker exec booth-ai-worker-1 cat /tmp/worker-status.json
```

然后到 **容器 → 编排 → booth-ai → 停止**。

### 2.2 备份数据库和账号

```bash
PG=1Panel-postgresql-PtfA
ROOT=$(docker exec $PG printenv POSTGRES_USER)
TS=$(date +%F-%H%M)
mkdir -p /opt/booth-ai/backup && cd /opt/booth-ai/backup
docker exec $PG pg_dump -U booth -d booth -Fc -f /tmp/booth.dump && docker cp $PG:/tmp/booth.dump booth-$TS.dump && docker exec $PG rm /tmp/booth.dump
docker exec $PG pg_dumpall -U $ROOT --globals-only > globals-$TS.sql
docker exec $PG psql -U booth -d booth -tAc "select count(*) from schema_migrations; select count(*) from projects;" | tee counts-$TS.txt
ls -lh
```

继续之前确认两点：`booth-*.dump` 的大小不是 0；`counts-*.txt` 里有两个数字。`globals-*.sql` 里有账号和密码哈希，用完后要和 dump 一起妥善保管。

---

## 3. 停止 PostgreSQL，移走旧数据目录

先到 **应用商店 → 已安装 → PostgreSQL → 停止**，然后执行：

```bash
cd /opt/1panel/apps/postgresql/postgresql
mv data data.alpine-bak && mkdir data && ls
```

---

## 4. 换镜像

到 **应用商店 → 已安装 → PostgreSQL → 参数 → 编辑**，打开「高级设置」→「编辑 compose 文件」，只改镜像这一行：

```yaml
image: pgvector/pgvector:0.8.7-pg18   # 原为 postgres:18.6-alpine
```

保存。如果没有自动启动，就手动点启动。然后确认容器已经起来：

```bash
docker ps --filter name=$PG --format '{{.Image}} {{.Status}}'
```

应显示 `pgvector/pgvector:0.8.7-pg18 ... (healthy)`。如果是 `health: starting`，等 20 秒再看一次。

容器会用 1Panel 原来的 root 账号和密码，在空目录里重新初始化，所以 1Panel 的数据库页面照样能连上。

---

## 5. 恢复账号和数据

```bash
cd /opt/booth-ai/backup
docker exec -i $PG psql -U $ROOT -d postgres < globals-$TS.sql
docker exec -i $PG psql -U $ROOT -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE booth OWNER booth;
REVOKE ALL ON DATABASE booth FROM PUBLIC;
SQL
docker cp booth-$TS.dump $PG:/tmp/booth.dump
docker exec $PG pg_restore -U booth -d booth --no-owner --exit-on-error /tmp/booth.dump && docker exec $PG rm /tmp/booth.dump
docker exec $PG psql -U $ROOT -d postgres -c "ALTER ROLE booth NOSUPERUSER NOCREATEROLE NOCREATEDB;"
docker exec $PG psql -U $ROOT -d postgres -tAc "select rolname, rolsuper, rolcreatedb from pg_roles where rolname='booth';"
docker exec $PG psql -U booth -d booth -tAc "select count(*) from schema_migrations; select count(*) from projects;"
cat counts-$TS.txt
```

- 第一条命令报 `role "xxx" already exists` 是正常的：root 账号在初始化时已经存在，booth 账号会以原来的密码哈希重建，`DATABASE_URL` 里的密码不用改。
- 通过 1Panel「数据库」页面创建的 booth 账号带有 `SUPERUSER`。导入完成后要去掉超级用户权限，结果应为 `booth|f|f`。booth 的迁移和运行都不需要超级用户（本地和 CI 一直用非超级用户），这样与本地约定一致。
- 最后两行输出的数字必须和 `counts-*.txt` 一致。
- 如果中途终端断开重连了，先重新设置 `PG=1Panel-postgresql-PtfA`、`ROOT=$(docker exec $PG printenv POSTGRES_USER)`，`TS` 改成备份文件名里的时间。

---

## 6. 切换 Redis 并启动应用

到 **容器 → 编排 → booth-ai → 编辑**，只改 `REDIS_URL` 这一行，保存后启动：

```yaml
REDIS_URL: redis://:<redis8 密码>@<redis8 容器名>:6379/0
```

---

## 7. 验证

```bash
docker exec $PG psql -U booth -d booth -tAc "select version()"
docker exec <redis8 容器名> redis-server --version
docker exec booth-ai-api-1 printenv REDIS_URL | sed 's#//:[^@]*@#//:***@#'      # 必须是新 Redis 容器名
docker exec booth-ai-worker-1 printenv REDIS_URL | sed 's#//:[^@]*@#//:***@#'
sleep 30; curl -sS http://127.0.0.1:3000/health/ready
docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | grep -E 'booth|postgres|redis'
```

预期结果：

- [ ] PostgreSQL 18.x，编译信息是 Debian / gcc（不再是 `linux-musl`）
- [ ] Redis `v=8.10.3`；api 和 worker 的 `REDIS_URL` 都指向新 Redis 容器。旧 Redis 在卸载前一直在运行，只看 health 无法判断有没有切换成功（实际执行时就漏改过一次主机名）
- [ ] `health/ready` 返回的 database、redis、storage 都是 `ok`
- [ ] api、worker 为 healthy
- [ ] 两个前端都能重新登录，方案、项目数据完整
- [ ] 提交一次换主题任务，进度实时更新并且能正常完成

---

## 回滚

| 出问题的部分 | 操作 |
|--------------|------|
| Redis | 编排里把 `REDIS_URL` 改回旧实例（`1Panel-redis-xCYH` 和原来的密码），保存重启 |
| PostgreSQL | 停止 PostgreSQL 应用 → `cd /opt/1panel/apps/postgresql/postgresql && mv data data.failed && mv data.alpine-bak data` → 镜像改回 `postgres:18.6-alpine` → 启动 |

---

## 收尾（稳定运行一两天后）

- 卸载旧的 Redis 7.4.10 应用。
- 删除 `/opt/1panel/apps/postgresql/postgresql/data.alpine-bak`。
- `/opt/booth-ai/backup/` 里的 dump 和 globals 保留一份，转存到备份位置后再从服务器上删除。
- **以后不要点这个 PostgreSQL 应用的「升级」按钮**，它会按应用商店的定义把镜像改回 `postgres:*-alpine`。要升级，就到「编辑 compose 文件」里改镜像标签，并同步修改本地 `D:/baolf/infra/compose.yml` 和 `infra/compose.ci.yaml`。
- 更新本地 `.local/1panel/docker-compose.yml` 里的 `REDIS_URL`，以及 `docs/1Panel服务端部署.md` 第 2.1 / 2.2 节。
