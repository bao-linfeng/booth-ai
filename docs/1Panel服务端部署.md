# 1Panel 服务端部署手册（boothapi.baolinfeng.cn）

> 适用：已装好 1Panel（含 OpenResty），参展商端、管理端静态文件已上线。
> 思路：PostgreSQL、Redis、Silo 直接在 1Panel 上安装；本地只打包服务端镜像，上传后用 1Panel「编排」启动 API + Worker。

---

## 0. 部署全景

```
浏览器 ── HTTPS ── 1Panel OpenResty（host 网络）
  ├─ boothai.baolinfeng.cn     参展商端静态网站（已上线）
  ├─ boothadmin.baolinfeng.cn  管理端静态网站（已上线）
  └─ boothapi.baolinfeng.cn    反向代理（本文新建）
       ├─ /booth-assets/*  → 127.0.0.1:19000  Silo（私有桶的签名下载）
       └─ /*               → 127.0.0.1:3000   API

Docker 网络 1panel-network：
  1Panel 应用：PostgreSQL · Redis      ← 应用商店安装
  1Panel 容器：silo                    ← 容器页面创建
  1Panel 编排：booth-ai（api + worker） ← 本地打包的服务端镜像
```

| 域名 | 用途 |
|------|------|
| `boothai.baolinfeng.cn` | 参展商端，出现在 `CORS_ORIGINS`、`CLIENT_PUBLIC_URL` |
| `boothadmin.baolinfeng.cn` | 管理端，出现在 `CORS_ORIGINS` |
| `boothapi.baolinfeng.cn` | API + 文件下载，出现在 `S3_PUBLIC_ENDPOINT`、两个前端的构建配置 |

> 三个域名必须同属 `baolinfeng.cn`：在线客服的访客令牌放在 `SameSite=Lax` 的 Cookie 里，前端和 API 同站才会带上。

文件链接是基于 `S3_PUBLIC_ENDPOINT` 的签名 URL（`https://boothapi.baolinfeng.cn/booth-assets/<key>?X-Amz-...`），由 OpenResty 原样转发给 Silo，不需要单独的文件域名。代理时 **Host、路径、查询参数都不能改**，否则签名校验失败。

---

## 1. 前置检查

- 服务器时间准确（`timedatectl status`），S3 签名与会话都依赖时间。
- `boothapi.baolinfeng.cn` 的 A 记录指向服务器（大陆服务器需备案）。
- 安全组只开放 80、443（SSH、面板端口仅限自己 IP）。`3000`、`5432`、`6379`、`19000`、`19001` 都不要对公网开放。
- 1Panel → 容器 中确认 OpenResty 是 `host` 网络，否则代理 `127.0.0.1` 会 502。
- 服务器能访问 `https://api.lingtong.net.cn`（灵通登录）和所用的 AI 供应商接口。
- CPU 架构：`uname -m`，`x86_64` 或 `aarch64`，第 3 步打包时要对应。
- 参展商端用 history 路由，静态网站必须回退到 `index.html`，否则站内跳转正常、刷新子页面（如 `/my-searches`）却返回 nginx 404。网站 → `boothai.baolinfeng.cn` → 伪静态，选「自定义」填入下面内容并保存。若校验报 `duplicate location "/"`，改为在「配置文件」原有的 `location /` 里加 `try_files` 这一行。管理端用 hash 路由，不需要配置。

  ```nginx
  location / {
      try_files $uri $uri/ /index.html;
  }
  ```

---

## 2. 在 1Panel 安装数据服务

先在 1Panel 终端生成后面要用的随机值，记到密码管理器里：

```bash
for name in SESSION_SECRET AI_MODEL_ENCRYPTION_KEY SILO_PASSWORD; do echo "$name=$(openssl rand -hex 32)"; done
```

### 2.1 PostgreSQL

PostgreSQL 与 Redis 是服务器上多个项目（booth-ai、nyz-rag 等）共用的 1Panel 应用，与本地共用基础设施 `D:/baolf/infra` 约定相同：PostgreSQL 镜像为 `pgvector/pgvector:pg18`（安装方法见 nyz-rag 仓库 `docs/deploy-1panel.md` 第 4.1 节，已安装则跳过第 1 步），各项目用自己的库与非超级用户账号，Redis 按项目分逻辑库（booth-ai 为 2 号）。

1. 应用商店 → PostgreSQL → 安装，版本选 **18**，**不要勾选「端口外部访问」**；高级设置中编辑 compose 文件，把镜像改为 `pgvector/pgvector:pg18`。
2. 数据库 → PostgreSQL → 创建数据库：名称 `booth`，用户 `booth`（不要设为超级用户），密码用 1Panel 生成的即可（只含字母数字，免得在 URL 里转义）。
3. 在 容器 列表里记下**容器名**（形如 `1Panel-postgresql-xxxx`）。数据库密码在 数据库 → PostgreSQL 列表的「密码」列，点眼睛图标可见。

### 2.2 Redis

1. 应用商店 → Redis → 安装，版本选 **7.x**，设置密码，**不要勾选「端口外部访问」**。
2. 数据库 → Redis → 顶部「设置」→ 持久化：打开 **appendonly**，`appendfsync` 选 `everysec`，保存。队列数据靠它在重启后保留。
3. 在 数据库 → Redis 页面的命令终端执行 `CONFIG GET appendonly`、`CONFIG GET maxmemory-policy`，应分别为 `yes`、`noeviction`（后者是默认值，BullMQ 要求）。
4. 应用商店 → 已安装 → Redis → 参数，记下密码；容器名在 容器 列表里看（形如 `1Panel-redis-xxxx`）。

> 这个 Redis 由多个项目共用，booth-ai 固定用 2 号库（下面 `REDIS_URL` 末尾的 `/2`，与本地一致）；不要执行 `FLUSHALL`。

### 2.3 Silo

先在 1Panel 终端建好数据目录（1Panel 创建容器时不会自动建目录，缺失会报 `bind source path does not exist`）：

```bash
mkdir -p /opt/booth-ai/silo
```

然后 容器 → 容器 → 创建，按表单从上到下填（以 1Panel v2.2.5 为准）：

| 位置 | 填写 |
|------|------|
| 名称 | `silo` |
| 镜像 | 勾选「手动输入」，填 `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`（拉取失败时先在 容器 → 配置 里设置镜像加速） |
| 端口 | 保持「暴露端口」，点「添加」两次：<br>服务器 `127.0.0.1:19000` → 容器 `9000`<br>服务器 `127.0.0.1:19001` → 容器 `9001`（控制台，可不加）<br>服务器一栏必须带 `127.0.0.1:`，且**前后不能有空格**，否则报「请输入合法的 ip 地址」 |
| 「网络」标签 | 把 `bridge` 改成 `1panel-network` |
| 「挂载」标签 | 添加：服务器 `/opt/booth-ai/silo` → 容器 `/data`，读写 |
| 「命令」标签 | Command 填 `server /data --console-address :9001`，Entrypoint 留空 |
| 「标签 & 环境变量」标签 | 环境变量添加两条：`MINIO_ROOT_USER=booth`、`MINIO_ROOT_PASSWORD=<SILO_PASSWORD>` |
| 「重启规则」标签 | 一直重启 |

确认后，容器列表里 `silo` 为「已启动」、端口显示 `127.0.0.1:19000-19001`；日志中出现 `API: http://...:9000` 即正常（`WARNING: Host local has more than 0 drives of set` 是单盘部署的固定提示，忽略）。

存储桶 `booth-assets` 不用手动建，API 启动时会自动创建（私有桶）。

---

## 3. 本地打包服务端镜像（Windows PowerShell）

打包产物统一放在仓库根目录的 `release/`（已在 `.gitignore` 中忽略）：

```powershell
cd D:\baolf\lingtong\booth-ai
$v = "20261020-01"   # 版本号，每次发布换一个
./scripts/package-server.ps1 -Version $v
# 服务器是 aarch64 时：./scripts/package-server.ps1 -Version $v -Platform linux/arm64
```

脚本自动读取根目录 `.env`，把 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` 保存到生产镜像，导出为 `release/booth-server-<版本>.tar`。本地邮件能发送且 `.env` 配置完整时，线上 Worker 无需再填写 SMTP 参数。每次打包都会重新读取邮件配置，修改 SMTP 后需重新打包发布。

只有这 6 项会写入镜像，不包含本地数据库、Redis、S3、会话密钥及 `CLIENT_PUBLIC_URL`；邮件链接使用下面编排里的线上地址。镜像和 tar 含邮件凭据，按含密码文件保管。生产打包统一使用脚本，它负责传入邮件配置并刷新配置缓存，避免继续用原来的裸 `docker build` 命令漏带配置。

1Panel 的「导入镜像」只能选服务器上的文件，所以分两步：

1. 系统 → 文件，进入 `/opt/booth-ai`，点「上传」把 `release/booth-server-<版本>.tar` 传上去。
2. 容器 → 镜像 → 导入镜像，路径选 `/opt/booth-ai/booth-server-<版本>.tar`，导入。镜像列表出现 `booth-ai-server:<版本>` 后，在文件管理里删掉服务器上的 tar。本地 `release/` 里的旧 tar 留最近一两个用于回滚即可。

---

## 4. 编排部署 API + Worker

1Panel → 容器 → 编排 → 创建编排，名称 `booth-ai`，选择「编辑」，粘贴下面的内容并替换所有 `<...>`。

> 填好真实值的版本建议在本地另存一份到 `.local/1panel/docker-compose.yml`（`.local/` 已被忽略，不会提交），以后发布改版本号时直接复制。**不要把真实密钥写回本文档。**

```yaml
x-server: &server
  image: booth-ai-server:20261020-01   # 发布新版本时只改这一处
  pull_policy: never
  init: true
  restart: unless-stopped
  networks: [1panel-network]
  logging:
    driver: json-file
    options: { max-size: '20m', max-file: '5' }
  environment:
    NODE_ENV: production
    LOG_LEVEL: info
    TRUST_PROXY: '1'
    DATABASE_URL: postgres://booth:<数据库密码>@<PostgreSQL 容器名>:5432/booth
    REDIS_URL: redis://:<Redis 密码>@<Redis 容器名>:6379/2
    S3_ENDPOINT: http://silo:9000
    S3_PUBLIC_ENDPOINT: https://boothapi.baolinfeng.cn
    S3_BUCKET: booth-assets
    S3_ACCESS_KEY: booth
    S3_SECRET_KEY: <SILO_PASSWORD>
    SESSION_SECRET: <SESSION_SECRET>
    AI_MODEL_ENCRYPTION_KEY: <AI_MODEL_ENCRYPTION_KEY>
    EXTERNAL_API_URL: https://api.lingtong.net.cn
    CORS_ORIGINS: https://boothai.baolinfeng.cn,https://boothadmin.baolinfeng.cn
    CLIENT_PUBLIC_URL: https://boothai.baolinfeng.cn
    # 打包脚本已内置本地 SMTP；以下仅用于覆盖镜像中的配置
    # 465 端口 SMTP_SECURE 为 'true'，587 为 'false'
    # SMTP_HOST: smtp.example.com
    # SMTP_PORT: '465'
    # SMTP_SECURE: 'true'
    # SMTP_USER: ...
    # SMTP_PASSWORD: ...
    # SMTP_FROM: 灵通展台 <noreply@example.com>
    # PROJECT_NOTIFICATION_WEBHOOK_URL: https://...
    # PROJECT_NOTIFICATION_WEBHOOK_SECRET: 至少 32 字节

services:
  api:
    <<: *server
    # 每次启动先执行数据库迁移和建桶（都是幂等的），成功后再启动 API
    command: [sh, -c, 'node dist/scripts/migrate.js && node dist/scripts/storage-init.js && exec node dist/api.js']
    ports:
      - '127.0.0.1:3000:3000'
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 30s

  worker:
    <<: *server
    command: [node, dist/worker.js]
    # 让进行中的 AI 调用跑完；worker 内部 170 秒兜底退出
    stop_grace_period: 180s
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: [CMD, node, -e, "process.exit(Date.now()-require('node:fs').statSync('/tmp/worker-ready').mtimeMs<30000?0:1)"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s

networks:
  1panel-network:
    external: true
```

保存后 1Panel 会执行 `docker compose up -d`。worker 等 api 健康后才启动，首次部署要多等一两分钟（要跑完全部迁移）。

`booth-ai-api-1` 的日志里依次出现 `Applied migration ...`、`Database migrations ready`、`Private storage bucket ready`、`Server listening at http://...:3000` 即成功。`FastifyDeprecation` 和 `strict mode: use allowUnionTypes` 两类提示不影响运行。

> - 密码里若有 `$`，在 YAML 中要写成 `$$`；有 `@ : / #` 等字符时，`DATABASE_URL`/`REDIS_URL` 里要做 URL 编码。
> - `AI_MODEL_ENCRYPTION_KEY` 用来加密数据库里的 AI 供应商凭据，**上线后不能再改**，要和数据库备份一起保存。要迁移本地数据时必须填本地 `.env` 里的值（见第 7 节）。
> - `SESSION_SECRET` 改了所有用户需要重新登录。
> - `S3_PUBLIC_ENDPOINT` 不要带 `/booth-assets`；`CORS_ORIGINS` 不带末尾 `/`、不能用通配符。
> - 生产环境不注册 Swagger `/docs`，属正常。
> - 编排中显式设置的 SMTP 参数优先于镜像内置值；没有配置时自动使用打包值。需要禁用邮件时，在共享 `environment` 中设置 `SMTP_HOST: ''`。API 和 Worker 必须使用同一份邮件配置。

---

## 5. 1Panel 网站：`boothapi.baolinfeng.cn`

### 5.1 创建网站与证书

1. 网站 → 创建网站 → **反向代理**：主域名 `boothapi.baolinfeng.cn`，代理地址 `http://127.0.0.1:3000`。
2. 网站 → 证书：申请 `boothapi.baolinfeng.cn` 的证书；进入网站 → HTTPS 启用，勾选 HTTP 自动跳转 HTTPS。

### 5.2 代理规则

进入网站后按下面顺序改，**顺序不能乱**：第 1 步定义的 `$booth_cors_origin` 变量，第 3 步的规则会用到，先加规则会导致配置校验失败。每次保存 1Panel 都会先校验 nginx 配置，失败时不会生效。

**第 1 步：配置文件。** 点顶部「配置文件」，在 `server { ... }` 最后一行 `include /www/sites/boothapi.baolinfeng.cn/proxy/*.conf;` 的**上面**插入下面这段，保存：

```nginx
client_max_body_size 64m;   # 后端上传上限 50 MiB，代理层留余量

set $booth_cors_origin "";
if ($http_origin ~* "^https://(boothai|boothadmin)\.baolinfeng\.cn$") {
    set $booth_cors_origin $http_origin;
}
```

> 若保存时报 `"client_max_body_size" directive is duplicate`，说明文件里原本就有，改原来那行的值并删掉新加的这行。

**第 2 步：root 规则。** 基本 → 反向代理，root（`/` → `http://127.0.0.1:3000`）这一行点「源文」，整段替换为：

```nginx
location ^~ / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    # 任务进度与在线客服使用 SSE 长连接，必须关闭缓冲
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

**第 3 步：assets 规则。** 点「创建」，代理设置填：

| 字段 | 值 |
|------|----|
| 名称 | `assets` |
| 匹配规则 | `^~` |
| 前端请求路径 | `/booth-assets/` |
| 后端代理地址 | `http` + `127.0.0.1:19000` |
| 后端域名 | `$host`（保持默认，**不能改**，否则签名校验失败） |

确认后列表里多出 assets 一行，点它的「源文」，整段替换为：

```nginx
location ^~ /booth-assets/ {
    # proxy_pass 末尾不带路径：URI 原样转发，Host 保持 boothapi.baolinfeng.cn，签名才能校验通过
    proxy_pass http://127.0.0.1:19000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 300s;

    # 前端用 fetch 下载签名文件时需要 CORS；只放行两个前端域名
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Expose-Headers;
    add_header Access-Control-Allow-Origin $booth_cors_origin always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Range, Content-Type" always;
    add_header Access-Control-Expose-Headers "ETag, Content-Length, Content-Range, Content-Disposition" always;
    add_header Vary Origin always;
    if ($request_method = OPTIONS) {
        return 204;
    }
}
```

两条规则别贴反了：

| 规则 | 源文第一行 | proxy_pass |
|------|-----------|------------|
| root | `location ^~ / {` | `http://127.0.0.1:3000` |
| assets | `location ^~ /booth-assets/ {` | `http://127.0.0.1:19000` |

---

## 6. 验证与验收

在任意能上网的终端执行：

```bash
B=https://boothapi.baolinfeng.cn
curl -sS $B/health/ready; echo
# {"status":"ok","checks":{"database":"ok","redis":"ok","storage":"ok"}}
curl -sS $B/booth-assets/
# Silo 返回的 XML <Code>AccessDenied</Code>（私有桶）属正常；若是 JSON 的 404，说明 assets 规则没生效、请求落到了 API
curl -sS -i -X OPTIONS $B/booth-assets/x.png -H 'Origin: https://boothadmin.baolinfeng.cn' -H 'Access-Control-Request-Method: GET' | grep -i access-control-allow-origin
# access-control-allow-origin: https://boothadmin.baolinfeng.cn
curl -sS -i -X OPTIONS $B/api/v1/client/auth/login -H 'Origin: https://boothai.baolinfeng.cn' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
# access-control-allow-origin: https://boothai.baolinfeng.cn
curl -sS $B/api/v1/admin/me; echo
# 401，reason 为 AUTH_REQUIRED
curl -sS -o /dev/null -w '%{http_code}\n' https://boothai.baolinfeng.cn/my-searches
# 200；404 说明参展商端没配 index.html 回退（见第 1 节）
```

用 Silo 凭据生成一个指向不存在对象的签名 URL 再访问，应返回 `NoSuchKey`（签名通过、只是没有文件）；返回 `SignatureDoesNotMatch` 则是代理改了 Host 或路径。

验收清单：

- [ ] 1Panel 容器列表中 api、worker 为 healthy，PostgreSQL、Redis、silo 运行中
- [ ] 两个前端登录、登出正常，请求地址是 `https://boothapi.baolinfeng.cn/api/v1/...`，无 CORS 报错
- [ ] 方案图片能显示，链接是 `https://boothapi.baolinfeng.cn/booth-assets/...`（不能出现 `localhost`、`silo`）
- [ ] 清单/素材下载正常
- [ ] 提交一次换主题/画稿任务：进度实时更新（SSE 没被缓冲），积分结算正确
- [ ] 在线客服：刷新页面后会话还在
- [ ] 能收到询价回执邮件；后台「保存并发送报价」后收到带 Excel 附件的报价邮件，时间线出现投递成功

首次业务配置：用灵通账号登录管理端（账号需在灵通拥有已授权角色，`ROLE_ADMIN` 默认有全部权限；系统没有默认管理员账号），全新库时再配置 AI 供应商/模型/用途、导入方案与素材。

---

## 7.（可选）迁移本地开发数据

**必须在第 4 步首次启动编排之前做**（目标库要为空），且编排里的 `AI_MODEL_ENCRYPTION_KEY` 要填本地 `.env` 里的值。Redis 队列和登录会话不迁移，上线后所有人重新登录。

本地导出（PowerShell，仓库根目录）：

```powershell
cd D:\baolf\lingtong\booth-ai
New-Item -ItemType Directory -Force release | Out-Null
# 数据库（在容器内生成再拷出，不要用 PowerShell 的 > 重定向）
docker compose --env-file .env -f infra/compose.dev.yaml exec -T postgres pg_dump -U booth -d booth -Fc -f /tmp/booth.dump
docker compose --env-file .env -f infra/compose.dev.yaml cp postgres:/tmp/booth.dump ./release/booth.dump
# 对象存储（Silo 镜像自带 mc，凭据取容器自己的环境变量）
docker compose --env-file .env -f infra/compose.dev.yaml exec -T silo sh -c 'mc alias set src http://127.0.0.1:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mirror src/booth-assets /tmp/export'
docker compose --env-file .env -f infra/compose.dev.yaml cp silo:/tmp/export ./release/silo-export
tar -czf release/silo-export.tar.gz -C release/silo-export .
```

把 `release/` 下的 `booth.dump`、`silo-export.tar.gz` 上传到服务器 `/opt/booth-ai/`，然后在 1Panel 终端执行（`PG` 换成第 2.1 步记下的容器名）：

```bash
cd /opt/booth-ai
PG=1Panel-postgresql-xxxx

docker cp booth.dump $PG:/tmp/booth.dump
docker exec $PG pg_restore -U booth -d booth --no-owner --exit-on-error /tmp/booth.dump
docker exec $PG rm /tmp/booth.dump

mkdir -p silo-export && tar -xzf silo-export.tar.gz -C silo-export
docker cp silo-export silo:/tmp/import
docker exec silo sh -c 'mc alias set dst http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mb --ignore-existing dst/booth-assets && mc mirror /tmp/import dst/booth-assets && rm -rf /tmp/import'

rm -rf booth.dump silo-export.tar.gz silo-export
```

本地 `release/` 里的 `booth.dump`、`silo-export*` 含业务数据，用完即删。之后回到第 4 步启动编排；迁移只会补跑缺少的版本，若报 checksum mismatch，说明本地库与当前代码的迁移文件不一致，先排查，不要手改 `schema_migrations`。

---

## 8. 日常运维

### 8.1 发布新版本

1. 本地执行第 3 步（换新版本号），在 1Panel 导入新镜像。
2. 先备份数据库（8.2 的数据库备份任务手动执行一次）。
3. 容器 → 编排 → `booth-ai` → 编辑，把 `image:` 改成新版本号，保存。api 重启时自动迁移，worker 最多等 180 秒让进行中的任务收尾。
4. `curl -sS http://127.0.0.1:3000/health/ready` 确认；旧镜像保留一两个用于回滚，其余在 容器 → 镜像 中清理。

回滚：把 `image:` 改回旧版本。**只有新版本没有新增迁移，或新增迁移与旧代码兼容时才能直接回滚**，否则要先恢复数据库备份。

### 8.2 备份

1Panel → 计划任务，建三个任务（建议每天凌晨，保留 14 份，备份到云存储账号，只存在本机的不算备份）：

| 类型 | 内容 |
|------|------|
| 备份数据库 | PostgreSQL → `booth` |
| 备份目录 | `/opt/booth-ai/silo` |
| 备份目录 | 编排 `booth-ai` 所在目录（编排页面可看到路径），里面有 `AI_MODEL_ENCRYPTION_KEY` |

> 丢了 `AI_MODEL_ENCRYPTION_KEY`，数据库里已加密的 AI 凭据就无法恢复。恢复数据库前先在编排里停止 `booth-ai`，在 数据库 → PostgreSQL → 备份列表 中恢复后再启动。

### 8.3 诊断

- 日志、资源占用：1Panel → 容器，点对应容器。
- Worker 状态：`docker exec booth-ai-worker-1 cat /tmp/worker-status.json`
- Silo 控制台：本机 `ssh -L 19001:127.0.0.1:19001 root@服务器IP`，浏览器开 `http://localhost:19001`，用 `booth` / `SILO_PASSWORD` 登录。

---

## 9. 常见问题

| 现象 | 排查方向 |
|------|----------|
| 编排报 `pull access denied for booth-ai-server` | 镜像没导入，或 `image:` 版本号与导入的不一致 |
| 编排报 `network 1panel-network not found` | 1Panel 应用还没装过；先装 PostgreSQL/Redis 会自动创建该网络 |
| api 反复重启，日志 `Missing/Invalid ...` | 对应环境变量缺失或格式错误；`AI_MODEL_ENCRYPTION_KEY` 必须是 64 位十六进制 |
| api 日志 `Migration failed` | 数据库地址/密码不对；若是 `permission denied for schema public`，在 PostgreSQL 中执行 `ALTER DATABASE booth OWNER TO booth; ALTER SCHEMA public OWNER TO booth;`（连 `booth` 库执行后者） |
| api 日志 `Waiting for Silo` 后失败 | silo 容器没在 `1panel-network`，或 `S3_ACCESS_KEY/S3_SECRET_KEY` 与 Silo 环境变量不一致 |
| `/health/ready` 返回 503 | 看 `checks` 中 database / redis / storage 哪一项失败 |
| 参展商端刷新子页面 404 Not Found（nginx） | 参展商端网站没配伪静态 `try_files $uri $uri/ /index.html;`（见第 1 节） |
| 网站 502 | `curl 127.0.0.1:3000/health/live` 是否通；OpenResty 是否 host 网络 |
| 浏览器 CORS 报错 | `CORS_ORIGINS` 与地址栏来源是否完全一致（协议、子域名、端口） |
| 图片 403 `SignatureDoesNotMatch` | 代理改了 Host 或路径；`S3_PUBLIC_ENDPOINT` 误带 `/booth-assets`；服务器时间不准 |
| 下载文件报 CORS | 配置文件里 `if ($http_origin ...)` 的域名是否正确；响应里是否出现两个 `Access-Control-Allow-Origin` |
| 任务进度/客服消息延迟 | `/` 规则的 `proxy_buffering off` 是否生效；是否开了 CDN 或网站缓存 |
| 上传返回 413 | `client_max_body_size` 是否配置；超过 50 MiB 是业务上限 |
| 所有人共用一个限流额度（429） | 前面加了 CDN 后要重新设置 `TRUST_PROXY` |
| worker 日志提示 eviction policy | Redis 的 `maxmemory-policy` 不是 `noeviction` |
| AI 任务一直排队 | worker 是否 healthy；管理端是否已给对应用途分配模型 |
| 本地发邮件、上线不发 | 是否使用第 3 节脚本打包；worker 日志出现 `SMTP not configured` 说明镜像未带入配置或 `SMTP_HOST` 被显式置空；出现 `Quotation email delivery failed` 按错误码排查 SMTP 认证和服务器出站网络。普通「追加跟进」不会发邮件，需要「保存并发送报价」 |
