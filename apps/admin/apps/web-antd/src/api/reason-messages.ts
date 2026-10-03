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
    '拉取模型超时（10 秒）：请检查 API 服务所在服务器到供应商的网络或代理配置后重试',
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
};
