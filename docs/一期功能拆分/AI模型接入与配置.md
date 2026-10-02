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

1. 运维配置独立的 `AI_MODEL_ENCRYPTION_KEY`（32 字节随机值的 64 位十六进制编码），`scripts/setup.ps1` 为本地环境自动生成。API/Worker 使用同一个值；数据库备份必须与此密钥一起保管，丢失后已保存的模型 Key 无法解密。生产环境请通过密钥管理系统注入，不要提交到仓库。
2. 执行迁移 `024_ai_model_configs.sql` 与 `025_ai_model_credentials.sql`，重启 API。管理员在「AI 模型配置」直接输入各提供商 API Key 并保存；服务端用 AES-256-GCM 加密存储在数据库，仅返回“已配置”状态，不回显密钥。编辑时留空保留原密钥；“清除密钥”同时停用模型，修改操作仅记录是否更换/清除，不记录密钥内容。随后启用千问/DeepSeek 并选择不同的主备优先级；默认全部停用，智选使用规则解析。
3. 配置图像模型每张图的整数积分并启用后，客户端方案详情展示可选模型及当前积分单价。实际收费价格必须由后端费用 offer 冻结，不能以客户端显示数值直接扣费；具体规则见本平台自建积分模块，通过 `credit_reservations` 预占扣费机制实现（`积分账本对接契约.md` 已作废）。

智选在 2.8 秒预算内有限重试并尝试备用模型；模型异常、非法 JSON/字典 ID、伪造证据或字段冲突时降级规则解析或要求客户确认。请求输入仅传公开字典项与用户文字，不传内部方案、备注或凭据。

## 代码结构与接入新模型

模型调用集中在 `apps/server/src/infra/ai/`，业务代码不再出现 `provider === 'xxx'` 分支：

| 文件 | 职责 |
|---|---|
| `types.ts` | 用途（`selection_parse` / `theme` / `artwork`）、配置记录与适配器接口 `ImageModelAdapter`、`TextModelAdapter` |
| `catalog.ts` | **模型目录 `AI_MODELS`**：每个（用途, 提供商）一条，包含模型 ID、展示名 `label` 与适配器；`imageAdapter()` / `textAdapter()` 按配置取适配器，`downloadGeneratedImage()` 只信任已登记适配器声明的结果域名 |
| `config.ts` | 后台配置读写：以目录为准合并 `ai_model_configs` 行（无行时按默认值展示，首次保存时自动插入），凭据 AES-256-GCM 加解密 |
| `image.ts` | 图像通用能力：错误分类 `ImageGenerationError`、超时、受限下载、格式归一化、`providerJson` 请求封装 |
| `providers/*.ts` | 各提供商适配器：`openai-image`、`gemini-image`、`wanx-image`（异步任务 + `poll`）、`openai-compatible-chat`（千问/DeepSeek 等兼容 Chat Completions 的文本模型） |

图像适配器约定：
- `edit(model, request)` 返回 `data:` URL 或受信 HTTPS URL；按 `model.purpose` 决定尺寸/画质（四面素材须达到 1536×1024）。
- 失败必须抛 `ImageGenerationError` 并正确设置 `retryable` / `outcomeUnknown`，Worker 依此决定重试、切换备用模型和积分结算；不要把上游响应正文写进错误信息或日志。
- `maxImagesPerRequest`：单次最多出图数。换主题 Worker 按 `min(上限, 剩余张数)` 请求，返回满额且未凑够时继续调用，返回不足则以部分成功结束。
- 异步提供商在 `edit` 中先调用 `onSubmitted(taskId)` 持久化任务号，并实现 `poll(model, taskId, deadline)` 供 Worker 崩溃后恢复轮询。
- `downloadHosts` 声明结果 URL 的域名后缀，只返回 `data:` URL 时也需列出官方 CDN 域名或留空数组。

接入新模型的步骤：
1. 复用已有适配器（例如另一个兼容 OpenAI Chat Completions 的文本模型只需 `openAiCompatibleChat(endpoint)`），或在 `providers/` 新增适配器并实现上述接口。
2. 在 `catalog.ts` 的 `AI_MODELS` 中追加一条（purpose, provider, model, label, adapter）。provider 为小写标识，同时作为凭据加密的关联数据，登记后不要改名。
3. 在 `tests/ai-image.test.ts` 补充请求格式与错误分类测试。无需数据库迁移或前端改动：后台「AI 模型配置」与客户端模型列表都直接展示目录中的 `label`，保存配置时自动创建对应行。

`model` 会写入任务快照，修改已有条目的模型 ID 会使进行中的任务因找不到同一模型修订而失败，应在无进行中任务时变更。从目录中移除的条目不再列出或调用，数据库中的旧行保留但被忽略。

