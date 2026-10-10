import type pg from 'pg';
import { activeAiModels, assignedAiModels } from '../../infra/ai/config.js';
import { textAdapter } from '../../infra/ai/protocols.js';
import type { ActiveAiModel } from '../../infra/ai/types.js';
import { errorCode, logger } from '../../infra/logger.js';
import type { CsLocale, TranslationDto } from './domain.js';
import { publishAgents, publishCustomer, type CsPublisher } from './events.js';

// 翻译管道（设计 §8.2、计划 G1）：pending 行即 outbox，Worker 认领后投递到 booth-cs 队列，调用模型时不持有数据库锁。

/** 同一事务内为消息创建 pending 译文行：翻译开启、已分配模型且语言不同时才创建 */
export async function queueTranslation(
  client: Pick<pg.PoolClient, 'query'>,
  messageId: string,
  source: CsLocale,
  target: CsLocale,
): Promise<boolean> {
  if (source === target) return false;
  const enabled = (await client.query<{ enabled: boolean }>('SELECT translation_enabled AS enabled FROM cs_settings WHERE id')).rows[0]
    ?.enabled;
  if (!enabled || (await assignedAiModels(client, 'cs_translation')).length === 0) return false;
  await client.query('INSERT INTO cs_message_translations(message_id,target_locale) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    messageId,
    target,
  ]);
  return true;
}

export interface PendingTranslation {
  messageId: string;
  locale: CsLocale;
}

/** 认领未投递或投递超过 2 分钟仍未完成的行（Worker 崩溃、队列丢失时自动重投） */
export async function claimPendingTranslations(db: Pick<pg.Pool, 'query'>, limit = 20): Promise<PendingTranslation[]> {
  return (
    await db.query<PendingTranslation>(
      `UPDATE cs_message_translations t SET dispatched_at=now(), updated_at=now()
    FROM (SELECT message_id, target_locale FROM cs_message_translations
          WHERE status='pending' AND (dispatched_at IS NULL OR dispatched_at < now() - interval '2 minutes')
          ORDER BY dispatched_at NULLS FIRST LIMIT $1 FOR UPDATE SKIP LOCKED) c
    WHERE t.message_id=c.message_id AND t.target_locale=c.target_locale
    RETURNING t.message_id AS "messageId", t.target_locale AS locale`,
      [limit],
    )
  ).rows;
}

const LANGUAGE_NAMES: Record<CsLocale, string> = {
  zh: '简体中文',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  ru: 'Русский',
  it: 'Italiano',
  es: 'Español',
  ar: 'العربية',
  hi: 'हिन्दी',
  pt: 'Português',
  ms: 'Bahasa Melayu',
};

export class PlaceholderError extends Error {
  code = 'PLACEHOLDER_MISMATCH';
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 编号保护：项目号、会话号、申请号、上下文方案编号与连续数字替换为 ⟦n⟧，译文必须原样保留每个占位符各一次 */
export function protectTokens(text: string, schemeCodes: string[] = []): { text: string; tokens: string[] } {
  const codes = [...new Set(schemeCodes.filter(Boolean))].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp([...codes, 'PJ-\\d{8}', 'CS-\\d{8}', '(?:QR|MR)-[0-9A-F-]{36}', '\\d+'].join('|'), 'g');
  const tokens: string[] = [];
  return { text: text.replace(pattern, match => `⟦${tokens.push(match) - 1}⟧`), tokens };
}

export function restoreTokens(translated: string, tokens: string[]): string {
  const seen = [...translated.matchAll(/⟦(\d+)⟧/g)].map(match => Number(match[1]));
  if (seen.length !== tokens.length || new Set(seen).size !== tokens.length || seen.some(index => index >= tokens.length))
    throw new PlaceholderError('Placeholder mismatch');
  return translated.replace(/⟦(\d+)⟧/g, (_match, index: string) => tokens[Number(index)]!);
}

export function translationMessages(body: string, source: CsLocale, target: CsLocale) {
  return [
    {
      role: 'system' as const,
      content: `你是翻译引擎。将用户内容从 ${LANGUAGE_NAMES[source]} 翻译为 ${LANGUAGE_NAMES[target]}。只输出译文；不增删内容；保留 ⟦n⟧ 占位符、换行与标点结构。`,
    },
    { role: 'user' as const, content: body },
  ];
}

interface Source {
  body: string;
  locale: CsLocale;
  seq: string;
  senderType: 'customer' | 'agent' | 'system';
  conversationId: string;
  customerLocale: CsLocale;
  status: string;
  agentAdminId: string | null;
  conversationStatus: 'queued' | 'active' | 'closed';
  schemeCodes: string[];
}

async function loadSource(db: Pick<pg.Pool, 'query'>, messageId: string, locale: CsLocale): Promise<Source | null> {
  return (
    (
      await db.query<Source>(
        `SELECT m.body, m.locale, m.seq, m.sender_type AS "senderType", m.conversation_id AS "conversationId",
      c.customer_locale AS "customerLocale", t.status, c.agent_admin_id AS "agentAdminId", c.status AS "conversationStatus",
      ARRAY(SELECT DISTINCT code FROM (SELECT x.snapshot->>'schemeCode' AS code
        FROM cs_conversation_contexts x WHERE x.conversation_id=c.id) codes WHERE code IS NOT NULL) AS "schemeCodes"
    FROM cs_message_translations t JOIN cs_messages m ON m.id=t.message_id JOIN cs_conversations c ON c.id=m.conversation_id
    WHERE t.message_id=$1 AND t.target_locale=$2 AND m.deleted_at IS NULL AND c.deleted_at IS NULL`,
        [messageId, locale],
      )
    ).rows[0] ?? null
  );
}

async function publishTranslation(redis: CsPublisher, source: Source, messageId: string, translation: TranslationDto) {
  const seq = Number(source.seq);
  // 客户语言的坐席消息译文推给客户；所有译文推给工作台
  if (source.senderType === 'agent')
    await publishCustomer(redis, source.conversationId, { type: 'message.translated', messageId, seq, translation });
  await publishAgents(redis, {
    type: 'message.translated',
    conversationId: source.conversationId,
    status: source.conversationStatus,
    agentAdminId: source.agentAdminId,
    seq,
  });
}

export type TranslateOutcome = 'done' | 'skipped' | 'unavailable';

/**
 * 按主备顺序调用 cs_translation 模型；占位符缺失视为该模型失败并换下一个。全部失败时抛错交给队列重试。
 * 没有可用模型时直接标记 failed（重试没有意义）。
 */
export async function translateMessage(
  pool: Pick<pg.Pool, 'query'>,
  encryptionKey: string,
  redis: CsPublisher,
  messageId: string,
  locale: CsLocale,
  models?: ActiveAiModel[],
): Promise<TranslateOutcome> {
  const source = await loadSource(pool, messageId, locale);
  if (!source || source.status !== 'pending') return 'skipped';
  const candidates = models ?? (await activeAiModels(pool, 'cs_translation', encryptionKey));
  if (candidates.length === 0) {
    await failTranslation(pool, redis, messageId, locale, 'MODEL_UNAVAILABLE');
    return 'unavailable';
  }
  const { text, tokens } = protectTokens(source.body, source.schemeCodes);
  let lastError: unknown = null;
  for (const model of candidates) {
    try {
      const output = await textAdapter(model).complete(model, {
        messages: translationMessages(text, source.locale, locale),
        maxTokens: 2000,
        json: false,
        signal: AbortSignal.timeout(30_000),
      });
      const body = restoreTokens(output.trim(), tokens);
      if (!body) throw new PlaceholderError('Empty translation');
      const updated = await pool.query(
        `UPDATE cs_message_translations SET status='done', body=$3, model_id=$4, attempts=attempts+1,
        last_error_code=NULL, updated_at=now() WHERE message_id=$1 AND target_locale=$2 AND status='pending'`,
        [messageId, locale, body.slice(0, 4000), model.id],
      );
      if (updated.rowCount === 1) await publishTranslation(redis, source, messageId, { locale, status: 'done', body: body.slice(0, 4000) });
      return 'done';
    } catch (error) {
      lastError = error;
      logger.warn({ messageId, locale, modelId: model.id, code: errorCode(error) }, 'Customer service translation attempt failed');
    }
  }
  await pool.query(
    `UPDATE cs_message_translations SET attempts=attempts+1, last_error_code=$3, updated_at=now()
    WHERE message_id=$1 AND target_locale=$2 AND status='pending'`,
    [messageId, locale, errorCode(lastError).slice(0, 64)],
  );
  throw lastError instanceof Error ? lastError : new Error('Translation failed');
}

/** 重试耗尽或无模型时终态失败；前端显示原文并标注“翻译失败” */
export async function failTranslation(
  pool: Pick<pg.Pool, 'query'>,
  redis: CsPublisher,
  messageId: string,
  locale: CsLocale,
  code: string,
): Promise<void> {
  const updated = await pool.query(
    `UPDATE cs_message_translations SET status='failed', last_error_code=$3, updated_at=now()
    WHERE message_id=$1 AND target_locale=$2 AND status='pending'`,
    [messageId, locale, code.slice(0, 64)],
  );
  if (updated.rowCount !== 1) return;
  const source = await loadSource(pool, messageId, locale);
  if (source) await publishTranslation(redis, source, messageId, { locale, status: 'failed', body: null });
}
