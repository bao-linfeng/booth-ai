import { message } from 'ant-design-vue';

import { claimProjectApi } from '#/api/core/projects';

import { failureReason } from './presentation';

// 结果未确认（网络失败）时重试沿用同一个幂等键，避免把自己上次已成功的领取误报为"已被领取"
const pendingKeys = new Map<string, string>();

/**
 * 领取待分配项目（分配给自己）。成功或已被他人领取时返回 true，调用方据此刷新数据。
 * 失败提示（含"已被 XX 领取"）由请求拦截器按 reason 统一弹出。
 */
export async function claimProject(projectId: string): Promise<boolean> {
  const requestKey = pendingKeys.get(projectId) ?? crypto.randomUUID();
  pendingKeys.set(projectId, requestKey);
  try {
    await claimProjectApi(projectId, { requestKey });
    pendingKeys.delete(projectId);
    message.success('已领取，项目已分配给你');
    return true;
  } catch (error) {
    const reason = failureReason(error);
    if (reason) pendingKeys.delete(projectId);
    return reason === 'PROJECT_ALREADY_ASSIGNED';
  }
}
