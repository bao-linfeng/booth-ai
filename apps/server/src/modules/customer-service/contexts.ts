import type pg from 'pg';
import { csError, type ContextInput, type ProjectSnapshot, type SchemeSnapshot, type Subject } from './domain.js';

// 上下文白名单快照（设计 §5）：逐个字段构造，禁止展开 request_snapshot，避免成本、联系人等内部信息进入客服数据。
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
    return { kind: 'scheme', ref: row.code, projectId: null, snapshot: schemeSnapshot(row) };
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
