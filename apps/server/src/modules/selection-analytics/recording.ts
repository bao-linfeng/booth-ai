import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Requirement } from '../selection/domain.js';
import type { ParseRecordInput, RecordedMatchItem, SearchRecordInput, SelectionIdentity } from './types.js';

const visitorPattern = /^[a-zA-Z0-9_-]{16,128}$/;

export async function ensureAttempt(pool: pg.Pool, attemptId: string | undefined, identity: SelectionIdentity): Promise<string> {
  if (attemptId) {
    const existing = (await pool.query<{ id: string }>('SELECT id FROM selection_attempts WHERE id=$1 AND visitor_id=$2', [attemptId, identity.visitorId])).rows[0];
    if (existing) {
      await pool.query('UPDATE selection_attempts SET user_id=COALESCE($2,user_id),last_seen_at=now() WHERE id=$1', [existing.id, identity.userId]);
      return existing.id;
    }
  }
  const created = await pool.query<{ id: string }>(
    'INSERT INTO selection_attempts(id,visitor_id,user_id) VALUES($1,$2,$3) RETURNING id',
    [attemptId ?? randomUUID(), identity.visitorId, identity.userId],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error('Selection attempt was not created');
  return id;
}

export async function recordParse(pool: pg.Pool, input: ParseRecordInput): Promise<string> {
  const result = await pool.query<{ id: string }>(`
    INSERT INTO selection_parses(
      attempt_id,visitor_id,user_id,input_text,form_requirement,final_requirement,parser,degraded,
      field_sources,overrides,clarifications,unhandled_text,warnings,rules_version,dictionary_version,duration_ms,prompt_snapshot
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING id`, [
      input.attemptId, input.identity.visitorId, input.identity.userId, input.inputText,
      JSON.stringify(input.formRequirement), JSON.stringify(input.result.requirement), input.result.parser, input.result.degraded,
      JSON.stringify(input.result.fieldSources), JSON.stringify(input.result.overrides), JSON.stringify(input.result.clarifications),
      input.result.unhandledText, JSON.stringify(input.result.warnings), input.result.rulesVersion,
      input.result.dictionaryVersion, Math.max(0, Math.round(input.durationMs)), JSON.stringify(input.promptSnapshot ?? null),
    ]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Selection parse was not created');
  return id;
}

function snapshotItems(items: RecordedMatchItem[]) {
  return items.map(item => ({
    code: item.code,
    matchType: item.matchType,
    images: item.images.map(image => ({ assetId: image.assetId, order: image.order, width: image.width, height: image.height })),
    specifications: item.specifications,
    reasons: item.reasons,
    differences: item.differences,
    pendingConfirmations: item.pendingConfirmations,
    preferenceMisses: item.preferenceMisses,
  }));
}

export function extractDemandTerms(inputText: string, requirement: Requirement): string[] {
  const terms = [...requirement.keywords, ...inputText.toLowerCase().match(/[\p{Script=Han}]{2,12}|[a-z0-9_-]{3,}/giu) ?? []];
  return [...new Set(terms.map(term => term.trim()).filter(term => term.length >= 2))].slice(0, 50);
}

export async function recordSearch(pool: pg.Pool, input: SearchRecordInput): Promise<string> {
  const result = await pool.query<{ id: string }>(`
    INSERT INTO selection_searches(
      attempt_id,parse_id,visitor_id,user_id,mode,status,input_text,final_requirement,
       direct_count,reference_count,random_count,result_count,zero_match_reasons,demand_terms,
       result_snapshot,rules_version,dictionary_version,degraded_parse,duration_ms,match_diagnostics
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    RETURNING id`, [
      input.attemptId, input.parseId, input.identity.visitorId, input.identity.userId, input.mode,
       input.result.status, input.inputText, input.result.requirement, input.result.counts.direct,
       input.result.counts.reference, input.result.counts.random, input.result.counts.total,
       input.result.status === 'no_match' ? input.result.reasons : [], extractDemandTerms(input.inputText, input.result.requirement),
       JSON.stringify(snapshotItems(input.result.items)), input.result.rulesVersion, input.result.dictionaryVersion,
       input.degradedParse, Math.max(0, Math.round(input.durationMs)), JSON.stringify(input.result.diagnostics),
    ]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Selection search was not created');
  return id;
}

export async function linkVisitorToUser(pool: pg.Pool, visitorId: string, userId: string): Promise<void> {
  if (!visitorPattern.test(visitorId)) return;
  await pool.query('UPDATE selection_attempts SET user_id=COALESCE(user_id,$2) WHERE visitor_id=$1', [visitorId, userId]);
  await pool.query('UPDATE selection_parses SET user_id=COALESCE(user_id,$2) WHERE visitor_id=$1', [visitorId, userId]);
  await pool.query('UPDATE selection_searches SET user_id=COALESCE(user_id,$2) WHERE visitor_id=$1', [visitorId, userId]);
}
