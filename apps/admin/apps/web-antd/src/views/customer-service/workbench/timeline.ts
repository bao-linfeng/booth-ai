import type { AdminMessage, Translation } from '#/api/core/customer-service';

/** 合并消息：按 id 去重（后到的覆盖，例如译文更新），按 seq 升序 */
export function mergeMessages(
  current: AdminMessage[],
  incoming: AdminMessage[],
): AdminMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].toSorted((a, b) => a.seq - b.seq);
}

export function maxSeq(messages: AdminMessage[]): number {
  let max = 0;
  for (const message of messages) max = Math.max(max, message.seq);
  return max;
}

export function minSeq(messages: AdminMessage[]): number | undefined {
  let min: number | undefined;
  for (const message of messages) {
    if (min === undefined || message.seq < min) min = message.seq;
  }
  return min;
}

/** 客户消息显示坐席语言译文；坐席消息可展开查看客户语言译文。两者都取该消息唯一的译文行。 */
export function translationOf(message: AdminMessage): null | Translation {
  if (message.senderType === 'system' || message.kind === 'note') return null;
  return message.translations[0] ?? null;
}

export function translationHint(translation: null | Translation): string {
  if (!translation) return '';
  if (translation.status === 'pending') return '翻译中';
  if (translation.status === 'failed') return '翻译失败';
  return '';
}

/** 等待时长：不足 1 分钟显示秒，不足 1 小时显示分钟，否则显示小时与分钟 */
export function waitingText(since: null | string, now: number): string {
  if (!since) return '';
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

/** 需上报的已读位置：只在有新的客户消息时上报，避免重复请求 */
export function readTarget(
  messages: AdminMessage[],
  agentReadSeq: number,
): null | number {
  const latest = maxSeq(
    messages.filter((message) => message.senderType === 'customer'),
  );
  return latest > agentReadSeq ? maxSeq(messages) : null;
}
