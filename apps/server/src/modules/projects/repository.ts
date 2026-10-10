import type pg from 'pg';
import { projectError, type ProjectStatus } from './domain.js';
import type { MaterialsSnapshot, SchemeSnapshot } from './snapshot.js';
import { assigneeStatusSql, type AssigneeStatus } from './assignment.js';
import { dictionaryItemLabels } from '../dictionaries/service.js';

export interface RequestSnapshot {
  exhibition?: { name: string; countryCode: string; city: string; startDate: string; endDate: string };
  materialBudget?: { currency: string; amount: string }; contact: { name: string; email?: string; phone?: string; legacyDetail?: string };
  company?: string; customerType?: string; scopeCodes?: string[]; scopeNotes?: string; notes?: string; entryPoint?: string;
  originalDescription?: string; confirmedRequirements?: Record<string, unknown>; parsedRequirements?: Record<string, unknown>;
  requirementContext?: { originalDescription: string; confirmedRequirements: Record<string, unknown> };
  unresolvedQuestions?: string[]; matchingSummary?: Record<string, unknown>; legacyIncomplete?: boolean; referenceScheme?: unknown;
}
export interface ProjectRecord {
  projectId: string; projectNo: string; requestNo: string; sourceType: 'quote_request' | 'manual_request'; customerUserId: string | null;
  assigneeAdminId: string; assigneeName: string; assigneeStatus: AssigneeStatus; status: ProjectStatus; revision: number;
  schemeCode: string | null; request: RequestSnapshot; schemeSnapshot: SchemeSnapshot | null; materials: Partial<MaterialsSnapshot>;
  publicResult: string | null; createdAt: string; updatedAt: string;
}
export interface ProjectQuery {
  page?: number; pageSize?: number; projectNo?: string; schemeCode?: string; status?: ProjectStatus; sourceType?: string;
  exhibitionName?: string; city?: string; customerName?: string; createdFrom?: string; createdTo?: string;
  customerUserId?: string; assigneeAdminId?: string; exhibitionStartFrom?: string; exhibitionStartTo?: string;
}
export const projectColumns = `p.id AS "projectId",p.project_no AS "projectNo",p.request_no AS "requestNo",p.source_type AS "sourceType",
  p.customer_user_id AS "customerUserId",p.assignee_admin_id AS "assigneeAdminId",coalesce(a.nickname,a.username) AS "assigneeName",
  ${assigneeStatusSql('a')} AS "assigneeStatus",
  p.status,p.revision,p.scheme_code AS "schemeCode",p.request_snapshot AS request,p.scheme_snapshot AS "schemeSnapshot",
  p.materials_snapshot AS materials,p.public_result AS "publicResult",p.created_at AS "createdAt",p.updated_at AS "updatedAt"`;
export async function getProject(db: pg.Pool | pg.PoolClient,id: string, userId?: string, lock = false): Promise<ProjectRecord> {
  const row=(await db.query<ProjectRecord>(`SELECT ${projectColumns} FROM projects p JOIN admins a ON a.id=p.assignee_admin_id
    WHERE p.id=$1 ${userId ? 'AND p.customer_user_id=$2' : ''} ${lock ? 'FOR UPDATE OF p' : ''}`,userId ? [id,userId] : [id])).rows[0];
  if(!row) throw projectError('RESOURCE_NOT_FOUND',404);
  return row;
}
export async function listProjects(db: pg.Pool,query: ProjectQuery,userId?: string) {
  const args: unknown[]=[]; const conditions: string[]=[];
  const add=(clause:string,value:unknown)=>{args.push(value);conditions.push(clause.replace('?',`$${args.length}`));};
  if(userId) add('p.customer_user_id=?',userId);
  for(const [field,column] of Object.entries({projectNo:'p.project_no',schemeCode:'p.scheme_code',status:'p.status',sourceType:'p.source_type',
    customerUserId:'p.customer_user_id',assigneeAdminId:'p.assignee_admin_id'})) {
    const value=query[field as keyof ProjectQuery];if(value) add(`${column}=?`,value);
  }
  for(const [field,column] of Object.entries({exhibitionName:"p.request_snapshot->'exhibition'->>'name'",city:"p.request_snapshot->'exhibition'->>'city'"})) {
    const value=query[field as keyof ProjectQuery];if(value) add(`${column} ILIKE ?`,`%${String(value).replace(/[\\%_]/g,'\\$&')}%`);
  }
  if(query.customerName) add("concat(p.request_snapshot->>'company',' ',p.request_snapshot->'contact'->>'name') ILIKE ?",`%${query.customerName.replace(/[\\%_]/g,'\\$&')}%`);
  if(query.createdFrom) add('p.created_at>=?::date',query.createdFrom);
  if(query.createdTo) add("p.created_at<(?::date+interval '1 day')",query.createdTo);
  if(query.exhibitionStartFrom) add("p.request_snapshot->'exhibition'->>'startDate'>=?",query.exhibitionStartFrom);
  if(query.exhibitionStartTo) add("p.request_snapshot->'exhibition'->>'startDate'<=?",query.exhibitionStartTo);
  const where=conditions.length ? `WHERE ${conditions.join(' AND ')}`:'';
  const page=query.page ?? 1; const pageSize=query.pageSize ?? 20;
  const rows=await db.query<ProjectRecord>(`SELECT ${projectColumns} FROM projects p JOIN admins a ON a.id=p.assignee_admin_id ${where}
    ORDER BY p.updated_at DESC,p.id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,pageSize,(page-1)*pageSize]);
  const count=await db.query<{total:string}>(`SELECT count(*)::text AS total FROM projects p ${where}`,args);
  return {items:rows.rows,total:Number(count.rows[0]?.total ?? 0),page,pageSize};
}
export async function projectEvents(db: pg.Pool,id: string) {
  const rows=await db.query(`SELECT e.id,e.kind,e.actor_admin_id AS "actorAdminId",coalesce(a.nickname,a.username) AS "actorName",
    coalesce(t.nickname,t.username) AS "assigneeName",coalesce(f.nickname,f.username) AS "fromAssigneeName",e.payload,e.created_at AS "createdAt"
    FROM project_events e LEFT JOIN admins a ON a.id=e.actor_admin_id
    LEFT JOIN admins t ON t.id::text=e.payload->>'assigneeAdminId' LEFT JOIN admins f ON f.id::text=e.payload->>'fromAdminId'
    WHERE project_id=$1 ORDER BY e.created_at DESC,e.id DESC`,[id]);
  return rows.rows;
}
/** 确认条件中字典项 ID 对应的名称；关键词为自由文本，不参与查询。 */
export async function requirementOptionLabels(db: pg.Pool,request: RequestSnapshot) {
  const requirement=request.confirmedRequirements ?? request.requirementContext?.confirmedRequirements ?? {};
  const ids=Object.entries(requirement).filter(([key])=>key!=='keywords')
    .flatMap(([,value])=>Array.isArray(value)?value:[value]).filter((value):value is string=>typeof value==='string');
  return dictionaryItemLabels(db,[...new Set(ids)]);
}
