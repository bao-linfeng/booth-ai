/** 服务端 `error.reason` 的中文提示；未列出的原因回退到通用错误信息。 */
export const REASON_MESSAGES: Record<string, string> = {
  BASE_URL_INVALID:
    '接口地址无效：必须是 https 公网地址，不能包含账号、参数或指向内网',
  CREDENTIAL_REQUIRED: '需要先填写 API Key 才能启用或拉取模型',
  CREDITS_INVALID: '图像用途需填写每单位积分，文本用途不计积分',
  DISCOVERY_AUTH_FAILED: '拉取模型失败：API Key 无效或无权限',
  DISCOVERY_BAD_RESPONSE:
    '拉取模型失败：请确认 Base URL 包含正确的 API 路径，且供应商支持模型列表接口',
  DISCOVERY_ENDPOINT_INVALID: '拉取模型失败：接口地址指向内网或不可用',
  DISCOVERY_TIMEOUT:
    '拉取模型超时（60 秒）：请检查 API 服务所在服务器到供应商的网络或代理配置后重试',
  DISCOVERY_UNREACHABLE:
    '拉取模型失败：API 服务器无法连接供应商，请检查 Base URL、服务器网络及代理配置',
  KIND_UNSUPPORTED: '该协议不支持此模型类型',
  MODEL_IN_USE: '模型仍被用途分配使用，请先在「用途分配」中移除',
  MODEL_TAKEN: '该供应商下已添加过这个模型',
  NAME_TAKEN: '名称已存在',
  PARAMS_INVALID: '模型参数不合法',
  PROVIDER_IN_USE: '供应商下仍有模型，请先删除模型',
  PURPOSE_UNSUPPORTED: '所选模型不能用于该用途',
  REVISION_CONFLICT: '配置已被他人修改，请刷新后重试',
  // 项目跟进与报价
  ASSIGNMENT_CONFIG_CHANGED: '默认承接人配置已被他人修改，请刷新后重试',
  INVALID_ASSIGNEE: '所选人员不能承接项目：账号已停用或缺少项目查看/跟进权限',
  INVALID_STATUS_TRANSITION:
    '当前项目状态不允许该操作或目标状态，项目可能已被他人更新，请刷新后重新选择',
  OUTCOME_REQUIRED: '变更为已成交、未成交或已关闭时需填写结果或原因',
  PROJECT_REVISION_CHANGED: '项目已被他人更新，请刷新项目后重新提交',
  QUOTATION_REVISION_CHANGED: '报价已有更新的修订，请刷新比较后再保存',
  QUOTE_EVIDENCE_INVALID:
    '该平台报价修订不能作为发送依据：需为完整修订，发送时间不早于修订创建时间且在报价有效期内',
  QUOTE_EVIDENCE_REQUIRED:
    '变更为已报价需填写发送依据：发送时间、发送渠道，外部报价还需填写编号或说明',
  SCHEME_ALREADY_LINKED: '项目已关联方案，无需重复确认',
  SCHEME_UNAVAILABLE: '方案不存在或尚未就绪（需已发布、清单已核验且资产齐全）',
  // 文件上传
  FILE_TOO_LARGE:
    '文件超过大小上限：方案与清单导入不超过 20MB，方案资源不超过 50MB',
  // 方案资源
  IMAGE_INVALID: '图片无法识别，或文件格式与扩展名不符（支持 png、jpg、webp）',
  MASK_SIZE_MISMATCH: '蒙版像素尺寸需与配对效果图完全一致',
  RENDERING_ASPECT_INVALID: '效果图需为严格 16:9（如 1600×900、1920×1080）',
  RENDERING_FILE_MISSING: '配对效果图尚未上传文件，无法上传蒙版',
  RENDERING_HAS_PAIRED_MASK:
    '该效果图已配对蒙版，请确认一并删除，或先在蒙版管理中将蒙版改配其他效果图',
  // 在线客服
  AGENT_UNAVAILABLE: '目标坐席已不可用（账号停用或无回复权限）',
  CONVERSATION_ALREADY_CLAIMED: '已被其他坐席接入',
  CONVERSATION_CLOSED: '会话已结束',
  CONVERSATION_NOT_ACTIVE: '会话已在队列中，无需退回',
  CONVERSATION_NOT_FOUND: '会话不存在或无权查看',
  IDEMPOTENCY_CONFLICT: '消息重复提交且内容不一致',
  MESSAGE_INVALID: '消息不能为空、超过 2000 字或包含控制字符',
  NOT_CONVERSATION_AGENT: '仅当前接待坐席可执行此操作',
  TRANSFER_REASON_REQUIRED: '请填写改派原因（最多 500 字）',
  CONTACT_EMAIL_INVALID: '邮箱格式不正确',
  TOO_MANY_EMAILS: '离线通知邮箱最多 20 个',
};
