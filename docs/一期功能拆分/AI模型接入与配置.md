# AI 模型接入与配置

## 官方接口核对

| 场景 | 接口与模型 | 官方资料 |
|---|---|---|
| 智选文本解析 | 千问 `qwen-plus`，OpenAI 兼容 Chat Completions，`response_format: {type: 'json_object'}` | [阿里云千问兼容接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |
| 智选文本解析 | DeepSeek `deepseek-v4-flash`，`POST /chat/completions`，JSON 模式；提示词明确要求 JSON，需防空响应 | [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode)、[官方模型配置示例](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono) |
| 换主题 / 四面素材 | Gemini Nano Banana 系列，默认 `gemini-3.1-flash-image`。`POST /v1beta/models/{model}:generateContent`（官方标注为 legacy 但完全支持），`x-goog-api-key` 头鉴权；文字与原图 `inlineData` 作为多模态输入，`generationConfig: {responseModalities: ['IMAGE'], imageConfig: {aspectRatio, imageSize: '2K'}}`。换主题按原图最接近的官方比例取 `aspectRatio`，四面素材固定 `3:2`。每次请求只出 1 张图，带 `thought: true` 的中间草图会被丢弃；`promptFeedback.blockReason` 或安全类 `finishReason` 归类为 `PROVIDER_CONTENT_BLOCKED`，无最终图归类为 `PROVIDER_NO_IMAGE`。参考图超过 14 MB 时先转为长边 ≤3072 的 JPEG，避免超出 20 MB 内联请求上限 | [Gemini 图像生成和编辑](https://ai.google.dev/gemini-api/docs/image-generation)、[API Key](https://ai.google.dev/gemini-api/docs/api-key) |
| 换主题 | 通义万相 `wanx2.1-imageedit` 局部重绘，`description_edit_with_mask`，原图与**黑白**蒙版，异步任务 | [万相图像编辑 API](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference) |

旧需求中的 `wanx-x-painting` + `mask_color` 与上面的现行图像编辑接口不一致。现有品红蒙版在调用万相前必须转换为白色可修改、黑色不可修改的二值蒙版；Gemini 无与万相等价的硬蒙版参数，必须在生成后做区域外像素保护并验证画面质量。图像输出 URL 有有效期，需要保存到平台私有 S3。各提供商调用适配器已按下文「代码结构与接入新模型」实现；万相的二值蒙版转换与 Gemini 的区域外像素保护尚未实现。

## 配置流程

1. 运维配置独立的 `AI_MODEL_ENCRYPTION_KEY`（32 字节随机值的 64 位十六进制编码），`scripts/setup.ps1` 为本地环境自动生成。API/Worker 使用同一个值；数据库备份必须与此密钥一起保管，丢失后已保存的 API Key 无法解密。生产环境请通过密钥管理系统注入，不要提交到仓库。
2. 管理后台「系统配置 → AI 模型配置 → 供应商与模型」：
   - **新建供应商**：选择接口协议（OpenAI 及兼容接口 / Google Gemini / 阿里云 DashScope 原生接口），填写 Base URL（留空用官方地址）与 API Key，可先「测试连接」用未保存的表单值拉取模型列表。API Key 以 AES-256-GCM 加密存储，关联数据为供应商 id，接口只返回“已配置”状态；编辑时留空保留原密钥，审计只记录是否更换/清除。协议创建后不可修改。
   - **添加模型**：在供应商下选择模型类型（文本/图像，取决于协议能力），点击「从供应商拉取模型列表」实时获取型号后选择（也可手动输入），填写显示名称；参数表单按“协议 + 类型”由服务端声明自动生成并在保存时校验。
3. 「用途分配」标签页：为 AI 智选·需求解析、AI 换主题、四面平面素材分别选择模型并排序（第一个为主用）。图像用途在这里设置积分单价（换主题按张、四面素材按方向），同一个模型可以同时分配给换主题和四面素材并分别定价。未分配模型时该功能不可用（智选回退规则解析）。实际收费价格由后端费用 offer 冻结，不能以客户端显示数值直接扣费；具体规则见本平台自建积分模块（`credit_reservations` 预占扣费）。

智选在 2.8 秒预算内有限重试并尝试备用模型；模型异常、非法 JSON/字典 ID、伪造证据或字段冲突时降级规则解析或要求客户确认。请求输入仅传公开字典项与用户文字，不传内部方案、备注或凭据。

## 代码结构与扩展

配置分三层，存储在 `ai_providers` → `ai_models` → `ai_model_assignments`（迁移 `056_ai_providers_and_models.sql`，同时把旧 `ai_model_configs` 中已配置密钥的行迁入并删除旧表）：

| 层级 | 内容 | 修订语义 |
|---|---|---|
| 供应商 | 协议、Base URL、加密的 API Key、启用状态 | 修改立即生效，不影响已报价或进行中的任务 |
| 模型 | 所属供应商、类型（text/image）、模型 ID、参数、启用状态 | 任何修改使 `revision` +1；任务快照固定模型 id + revision，修改后旧报价失效（`OFFER_STALE`），进行中的任务不会再用新配置调用 |
| 用途分配 | 用途、模型、顺序、积分单价 | 按用途整体替换，乐观并发版本由当前分配内容计算 |

运行时只使用：已分配 + 模型启用 + 供应商启用且有密钥 + 协议支持该用途 + 图像用途有单价的模型，按顺序排列。

服务端代码在 `apps/server/src/infra/ai/`，业务代码不写任何供应商分支：

| 文件 | 职责 |
|---|---|
| `protocols.ts` | **协议注册表 `PROTOCOLS`**：每种协议的官方地址、模型列表拉取、文本/图像能力（适配器 + 参数表单定义 + 可服务的用途） |
| `providers/*.ts` | 各协议实现：`openai`（Chat Completions、Images Edits、`GET /models`）、`gemini`（generateContent 图像、`GET /models`）、`dashscope`（万相异步任务 + 推荐模型） |
| `config.ts` | 运行时读取分配给某用途的模型（`assignedAiModels` 不含密钥、`activeAiModels` 含解密后的密钥），凭据加解密 |
| `endpoint.ts` | Base URL 校验：仅 https 公网地址，禁止账号/参数/内网与本机地址；非官方域名在每次请求前重新解析 DNS，拒绝解析到内网的地址 |
| `discovery.ts` | 模型列表拉取（10 秒超时、禁止重定向、响应体上限），失败只返回 `AUTH_FAILED` / `UNREACHABLE` / `BAD_RESPONSE` / `ENDPOINT_INVALID` |
| `image.ts` | 图像通用能力：`ImageGenerationError` 分类、超时、受限下载、格式归一化、`providerJson` 请求封装 |

管理接口在 `modules/ai-models/service.ts`（`/api/v1/admin/ai-protocols`、`ai-providers`、`ai-providers/:id/models`、`ai-providers/probe`、`ai-models`、`ai-model-assignments`）。拉取已保存供应商的模型时只使用已保存的地址和密钥，密钥不会被发往请求中携带的其他地址。

图像适配器约定：
- `edit(model, request)` 返回 `data:` URL 或受信 HTTPS URL；按 `model.purpose` 决定尺寸/画质（四面素材须达到 1536×1024），按 `model.params` 读取管理员配置的参数，请求地址经 `providerEndpoint(model.baseUrl, path)` 校验。
- 失败必须抛 `ImageGenerationError` 并正确设置 `retryable` / `outcomeUnknown`，Worker 依此决定重试、切换备用模型和积分结算；不要把上游响应正文写进错误信息或日志。
- `maxImagesPerRequest`：单次最多出图数。换主题 Worker 按 `min(上限, 剩余张数)` 请求，返回满额且未凑够时继续调用，返回不足则以部分成功结束。
- 异步提供商在 `edit` 中先调用 `onSubmitted(taskId)` 持久化任务号，并实现 `poll(model, taskId, deadline)` 供 Worker 崩溃后恢复轮询。
- `downloadHosts` 声明结果 URL 的域名后缀；经中转服务返回其他域名的 URL 会被拒绝（`IMAGE_URL_UNTRUSTED`），返回 base64 不受影响。

日常接入新模型、新中转或新厂商（只要协议已支持）都只需在后台操作，无需改代码或迁移。需要写代码的情况：
1. **新协议**（接口格式不兼容现有三种）：在 `providers/` 实现适配器与模型列表拉取，在 `PROTOCOLS` 注册，并在 `tests/ai-image.test.ts` 补充请求格式与错误分类测试。
2. **已有协议的新能力**（如 Gemini 文本解析）：在该协议定义中增加 `text` / `image` 能力及参数表单。
3. **参数**：在能力的 `params` 中声明（数字范围或下拉选项），后台表单自动出现，服务端按声明校验并补默认值。
