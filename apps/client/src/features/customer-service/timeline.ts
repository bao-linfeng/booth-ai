import type { MessageDto, TranslationDto } from '@/services/api/customer-service'

// 客服时间线纯函数：合并去重、排序、分轮、译文显示与未读计算

/** 译文只会从 pending 走向 done/failed：迟到的旧响应不能把已推送的终态译文覆盖回 pending */
export function mergeMessages(current: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map(current.map(message => [message.id, message]))
  for (const message of incoming) {
    const known = byId.get(message.id)?.translation
    const stale = message.translation?.status === 'pending' && known && known.status !== 'pending'
    byId.set(message.id, stale ? { ...message, translation: known } : message)
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

export function applyTranslation(messages: MessageDto[], messageId: string, translation: TranslationDto): MessageDto[] {
  return messages.map(message => (message.id === messageId ? { ...message, translation } : message))
}

export function maxSeq(messages: MessageDto[]): number {
  return messages.reduce((max, message) => Math.max(max, message.seq), 0)
}

/** 补拉起点：有译文未完成的消息时从最早那条之前开始（翻译完成不产生新 seq，只能重取原消息），否则从已知最大 seq 开始 */
export function syncAfter(messages: MessageDto[]): number {
  const pending = messages.filter(message => message.translation?.status === 'pending')
  return pending.length ? minSeq(pending)! - 1 : maxSeq(messages)
}

export function minSeq(messages: MessageDto[]): number | undefined {
  return messages.length ? Math.min(...messages.map(message => message.seq)) : undefined
}

export interface Round { conversationId: string; conversationNo: string; startedAt: string; messages: MessageDto[] }

/** 按会话分轮：同一会话的消息归为一轮，轮次按首条消息排序 */
export function splitRounds(messages: MessageDto[]): Round[] {
  const rounds: Round[] = []
  for (const message of messages) {
    const last = rounds.at(-1)
    if (last?.conversationId === message.conversationId) last.messages.push(message)
    else rounds.push({ conversationId: message.conversationId, conversationNo: message.conversationNo, startedAt: message.createdAt, messages: [message] })
  }
  return rounds
}

/** 坐席消息默认显示客户语言译文；译文未完成或失败时显示原文并给出状态 */
export function displayBody(message: MessageDto, showOriginal: boolean): { body: string; status: 'translated' | 'pending' | 'failed' | 'original' } {
  const translation = message.senderType === 'agent' ? message.translation : null
  if (!translation) return { body: message.body, status: 'original' }
  if (translation.status === 'done' && translation.body && !showOriginal) return { body: translation.body, status: 'translated' }
  return { body: message.body, status: translation.status === 'done' ? 'original' : translation.status }
}

/** 各会话中坐席消息的最大 seq，用于上报已读 */
export function readTargets(messages: MessageDto[]): Map<string, number> {
  const targets = new Map<string, number>()
  for (const message of messages) {
    if (message.senderType === 'agent') targets.set(message.conversationId, Math.max(targets.get(message.conversationId) ?? 0, message.seq))
  }
  return targets
}

/** 未读：坐席消息 seq 大于对应会话已读位置的条数 */
export function unreadCount(messages: MessageDto[], readSeqs: Map<string, number>): number {
  return messages.filter(message => message.senderType === 'agent' && message.seq > (readSeqs.get(message.conversationId) ?? 0)).length
}
