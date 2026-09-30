# AI 模型接入与配置

## 官方接口核对

| 场景 | 接口与模型 | 官方资料 |
|---|---|---|
| 智选文本解析 | 千问 `qwen-plus`，OpenAI 兼容 Chat Completions，`response_format: {type: 'json_object'}` | [阿里云千问兼容接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |
| 智选文本解析 | DeepSeek `deepseek-v4-flash`，`POST /chat/completions`，JSON 模式；提示词明确要求 JSON，需防空响应 | [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode)、[官方模型配置示例](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono) |
| 换主题 | Gemini Nano Banana 系列图像编辑，原图与文字作为多模态输入 | [Gemini 图像生成和编辑](https://ai.google.dev/gemini-api/docs/image-generation) |
| 换主题 | 通义万相 `wanx2.1-imageedit` 局部重绘，`description_edit_with_mask`，原图与**黑白**蒙版，异步任务 | [万相图像编辑 API](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference) |

旧需求中的 `wanx-x-painting` + `mask_color` 与上面的现行图像编辑接口不一致。现有品红蒙版在调用万相前必须转换为白色可修改、黑色不可修改的二值蒙版；Gemini 无与万相等价的硬蒙版参数，必须在生成后做区域外像素保护并验证画面质量。图像输出 URL 有有效期，需要保存到平台私有 S3。当前只接入文本模型请求与解析，以及图像模型的配置/展示，**尚未实现图像提供商调用适配器、蒙版转换与生图任务**。图像生成及付费提交仍需与积分账本和蒙版资产流程联调，不因后台启用模型就开放生成。

## 配置流程

1. 运维配置独立的 `AI_MODEL_ENCRYPTION_KEY`（32 字节随机值的 64 位十六进制编码），`scripts/setup.ps1` 为本地环境自动生成。API/Worker 使用同一个值；数据库备份必须与此密钥一起保管，丢失后已保存的模型 Key 无法解密。生产环境请通过密钥管理系统注入，不要提交到仓库。
2. 执行迁移 `024_ai_model_configs.sql` 与 `025_ai_model_credentials.sql`，重启 API。管理员在「AI 模型配置」直接输入各提供商 API Key 并保存；服务端用 AES-256-GCM 加密存储在数据库，仅返回“已配置”状态，不回显密钥。编辑时留空保留原密钥；“清除密钥”同时停用模型，修改操作仅记录是否更换/清除，不记录密钥内容。随后启用千问/DeepSeek 并选择不同的主备优先级；默认全部停用，智选使用规则解析。
3. 配置图像模型每张图的整数积分并启用后，客户端方案详情展示可选模型及当前积分单价。实际收费价格必须由后端费用 offer 冻结，不能以客户端显示数值直接扣费；具体规则见本平台自建积分模块，通过 `credit_reservations` 预占扣费机制实现（`积分账本对接契约.md` 已作废）。

智选在 2.8 秒预算内有限重试并尝试备用模型；模型异常、非法 JSON/字典 ID、伪造证据或字段冲突时降级规则解析或要求客户确认。请求输入仅传公开字典项与用户文字，不传内部方案、备注或凭据。
