import type pg from 'pg';
import { csError, type ContextInput, type ProjectSnapshot, type SchemeSnapshot, type Subject } from './domain.js';

// 上下文白名单快照（设计 §5）：逐个字段构造，禁止展开 request_snapshot，避免成本、联系人等内部信息进入客服数据。
// ref 是会话内去重键：方案为 schemeCode，带换主题效果图的方案为 theme:<resultId>，项目为 projectId；方案编号一律从快照读取。
export interface ResolvedContext { kind: 'scheme' | 'project'; ref: string; projectId: string | null; snapshot: SchemeSnapshot | ProjectSnapshot }

export const contextNotFound = () => csError('CONTEXT_NOT_FOUND', 404);

export function schemeSnapshot(row: { code: string; name: string; lengthMm: number | null; widthMm: number | null; openingCount: number | null }): SchemeSnapshot {
  return { schemeCode: row.code, name: row.name, lengthMm: row.lengthMm, widthMm: row.widthMm, openingCount: row.openingCount };
}

export function projectSnapshot(row: {
  projectNo: string; schemeCode: string | null; sourceType: ProjectSnapshot['sourceType']; status: string; customerType: string | null;
  countryCode: string | null; city: string | null; exhibitionName: string | null; createdAt: Date;
}): ProjectSnapshot {
  return {
    projectNo: row.projectNo, schemeCode: row.schemeCode, sourceType: row.sourceType, status: row.status,
    customerType: row.customerType === 'company' ? 'company' : 'individual',
    countryCode: row.countryCode ?? '', city: row.city ?? '', exhibitionName: row.exhibitionName ?? '', submittedAt: row.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只读查询；不满足条件一律 404，不区分“不存在”和“无权限” */
export async function resolveContext(db: Pick<pg.Pool, 'query'>, subject: Subject, input: ContextInput): Promise<ResolvedContext> {
  if (input.kind === 'scheme') {
    const row = (await db.query<{ code: string; name: string; lengthMm: number | null; widthMm: number | null; openingCount: number | null }>(
      `SELECT code, name, length_mm AS "lengthMm", width_mm AS "widthMm", opening_count AS "openingCount"
       FROM schemes WHERE code=$1 AND publish_status='published'`, [input.schemeCode])).rows[0];
    if (!row) throw contextNotFound();
    if (!input.themeJobId) return { kind: 'scheme', ref: row.code, projectId: null, snapshot: schemeSnapshot(row) };
    // 换主题效果图：只取本人已完成任务此刻选定的那张，任务与方案须一致
    if (subject.kind !== 'user' || !UUID.test(input.themeJobId)) throw contextNotFound();
    const theme = (await db.query<{ resultId: string }>(
      `SELECT r.id AS "resultId" FROM theme_jobs j JOIN theme_job_results r ON r.id=j.selected_result_id AND r.job_id=j.id
       WHERE j.id=$1 AND j.user_id=$2 AND j.scheme_code=$3 AND j.status IN ('succeeded','partially_succeeded')`,
      [input.themeJobId, subject.userId, row.code])).rows[0];
    if (!theme) throw contextNotFound();
    return { kind: 'scheme', ref: `theme:${theme.resultId}`, projectId: null, snapshot: { ...schemeSnapshot(row), themeResultId: theme.resultId } };
  }
  if (!UUID.test(input.projectId)) throw contextNotFound();
  const owner = subject.kind === 'user' ? 'customer_user_id=$2' : 'customer_user_id IS NULL AND visitor_id=$2';
  const row = (await db.query<Parameters<typeof projectSnapshot>[0] & { id: string }>(
    `SELECT id, project_no AS "projectNo", scheme_code AS "schemeCode", source_type AS "sourceType", status,
       request_snapshot->>'customerType' AS "customerType", request_snapshot->'exhibition'->>'countryCode' AS "countryCode",
       request_snapshot->'exhibition'->>'city' AS city, request_snapshot->'exhibition'->>'name' AS "exhibitionName", created_at AS "createdAt"
     FROM projects WHERE id=$1 AND ${owner}`, [input.projectId, subject.kind === 'user' ? subject.userId : subject.visitorId])).rows[0];
  if (!row) throw contextNotFound();
  return { kind: 'project', ref: row.id, projectId: row.id, snapshot: projectSnapshot(row) };
}

/**
 * 换主题卡片的效果图对象键：凭会话内的上下文 ID 读取（ID 只有会话双方可见），会话已删除或图片不再属于任务用户时 404。
 * 供卡片里的固定图片地址按需换签（客户与坐席的 <img> 都带不了 Bearer）。
 */
export async function themeContextObjectKey(db: Pick<pg.Pool, 'query'>, contextId: string): Promise<string> {
  if (!UUID.test(contextId)) throw contextNotFound();
  const row = (await db.query<{ objectKey: string }>(
    `SELECT av.object_key AS "objectKey" FROM cs_conversation_contexts x
     JOIN cs_conversations c ON c.id=x.conversation_id AND c.deleted_at IS NULL
     JOIN theme_job_results r ON r.id=(x.snapshot->>'themeResultId')::uuid
     JOIN theme_jobs j ON j.id=r.job_id
     JOIN scheme_assets sa ON sa.id=r.asset_id AND sa.source='theme_generation' AND sa.visibility='private' AND sa.owner_user_id=j.user_id
     JOIN asset_versions av ON av.id=r.asset_version_id AND av.asset_id=sa.id
     WHERE x.id=$1 AND x.kind='scheme'`, [contextId])).rows[0];
  if (!row) throw contextNotFound();
  return row.objectKey;
}
