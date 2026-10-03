import { REASON_MESSAGES } from '#/api/reason-messages';

export function discoveryErrorMessage(error: unknown): string {
  const failure = error as null | {
    code?: string;
    response?: { data?: { error?: { reason?: string } } };
  };
  const reason = failure?.response?.data?.error?.reason;
  if (reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason];
  if (failure?.code === 'ECONNABORTED' || failure?.code === 'ETIMEDOUT') {
    return '等待模型列表超时，请检查管理后台到 API 服务器的连接后重试';
  }
  return '未能获取模型列表，请检查接口协议、Base URL 和 API Key 后重试';
}
