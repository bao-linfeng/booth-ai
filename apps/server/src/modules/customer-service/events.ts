import type { Redis } from 'ioredis';
import { errorCode, logger } from '../../infra/logger.js';
import type { ConversationDto, ConversationStatus, MessageDto, MessageRow, TranslationDto } from './domain.js';

// 实时事件（开发计划 §7）。消息先落库后推送：publish 失败只记录日志，前端通过 after=<seq> 补偿。
export type CsPublisher = Pick<Redis, 'publish'>;

export const AGENTS_CHANNEL = 'cs:agents';
export const conversationChannel = (conversationId: string) => `cs:conv:${conversationId}`;

export type CustomerEvent =
  | { type: 'message.created'; message: MessageDto }
  | { type: 'message.translated'; messageId: string; seq: number; translation: TranslationDto }
  | { type: 'conversation.updated'; conversation: ConversationDto }
  | { type: 'read'; agentReadSeq: number };

export type AgentEventType = 'queue.changed' | 'conversation.updated' | 'message.created' | 'message.translated' | 'read';
/**
 * 工作台事件只含 ID，详情由前端拉取；agentAdminId 用于按连接过滤。
 * message.created 额外带 senderType/kind，前端据此只对客户消息做新消息提醒。
 */
export interface AgentEvent {
  type: AgentEventType;
  conversationId: string;
  status: ConversationStatus;
  agentAdminId: string | null;
  seq?: number;
  senderType?: MessageRow['senderType'];
  kind?: MessageRow['kind'];
}

export async function publishSafe(redis: CsPublisher, channel: string, payload: unknown): Promise<void> {
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch (error) {
    logger.warn(
      { channel: channel.startsWith('cs:conv:') ? 'cs:conv' : channel, code: errorCode(error) },
      'Customer service event publish failed',
    );
  }
}

export async function publishCustomer(redis: CsPublisher, conversationId: string, event: CustomerEvent): Promise<void> {
  await publishSafe(redis, conversationChannel(conversationId), event);
}

export async function publishAgents(redis: CsPublisher, event: AgentEvent): Promise<void> {
  await publishSafe(redis, AGENTS_CHANNEL, event);
}

/** 工作台连接过滤：无 supervise 时丢弃他人会话的事件 */
export function agentEventVisible(payload: string, adminId: string, supervise: boolean): boolean {
  if (supervise) return true;
  try {
    const event = JSON.parse(payload) as Partial<AgentEvent>;
    return event.agentAdminId === null || event.agentAdminId === undefined || event.agentAdminId === adminId;
  } catch {
    return false;
  }
}
