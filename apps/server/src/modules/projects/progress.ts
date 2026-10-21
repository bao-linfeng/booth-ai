import type pg from 'pg';
import type { ProjectRecord } from './repository.js';

/** 客户端进度时间线的节点，只表达发生了什么；内部跟进内容、报价明细与承接人身份都不外露 */
export const progressSteps = [
  'submitted',
  'advisor_assigned',
  'advisor_changed',
  'following',
  'quote_sent',
  'won',
  'lost',
  'closed',
  'reopened',
] as const;
export type ProgressStep = (typeof progressSteps)[number];
export interface CustomerProgress {
  /** 客户可见内容（节点或顾问说明）最近一次变化的时间；改派之外的内部操作不计入 */
  updatedAt: Date;
  note: { content: string; publishedAt: Date } | null;
  /** 按时间正序 */
  timeline: { step: ProgressStep; at: Date }[];
}
interface EventRow {
  projectId: string;
  kind: string;
  status: string | null;
  fromStatus: string | null;
  assigneeAdminId: string | null;
  fromAdminId: string | null;
  quoteEvidence: boolean;
  publicResult: boolean;
  legacyStatus: string | null;
  createdAt: Date;
}
const statusSteps: string[] = ['following', 'won', 'lost', 'closed'];
const terminal = ['won', 'lost', 'closed'];
// 历史人工需求迁入时（036）的状态映射，迁入事件代替了当时没有记录的状态变化
const legacySteps: Record<string, ProgressStep> = { following_up: 'following', completed: 'closed' };

function stepOf(event: EventRow): ProgressStep | 'advisor' | null {
  switch (event.kind) {
    case 'accepted':
      return event.assigneeAdminId ? 'advisor' : null;
    case 'assignment':
      return event.assigneeAdminId !== event.fromAdminId ? 'advisor' : null;
    case 'legacy_import':
      return legacySteps[event.legacyStatus ?? ''] ?? null;
    case 'follow-up': {
      const changed = !!event.status && event.status !== event.fromStatus;
      // 已报价状态下再次发送报价（重新报价）也是客户可见的节点
      if (event.status === 'quoted' && (changed || event.quoteEvidence)) return 'quote_sent';
      if (!changed) return null;
      if (terminal.includes(event.fromStatus ?? '')) return 'reopened';
      return statusSteps.includes(event.status!) ? (event.status as ProgressStep) : null;
    }
    default:
      return null;
  }
}
/** 改变客户可见说明的事件；拆分前的跟进记录带 publicResult 时也会更新说明 */
const changesNote = (event: EventRow) => event.kind === 'public-result' || (event.kind === 'follow-up' && event.publicResult);

/** 客户可见进度：由项目事件推导时间线，列表与详情共用同一口径 */
export async function loadCustomerProgress(
  db: pg.Pool | pg.PoolClient,
  projects: Pick<ProjectRecord, 'projectId' | 'createdAt' | 'publicResult' | 'updatedAt'>[],
): Promise<Map<string, CustomerProgress>> {
  const rows = projects.length
    ? (
        await db.query<EventRow>(
          `SELECT project_id AS "projectId",kind,payload->>'status' AS status,payload->>'fromStatus' AS "fromStatus",
      payload->>'assigneeAdminId' AS "assigneeAdminId",payload->>'fromAdminId' AS "fromAdminId",
      payload ? 'quoteEvidence' AS "quoteEvidence",payload ? 'publicResult' AS "publicResult",
      payload->>'legacyStatus' AS "legacyStatus",created_at AS "createdAt"
    FROM project_events WHERE project_id=ANY($1::uuid[]) AND kind IN ('accepted','assignment','follow-up','public-result','legacy_import')
    ORDER BY created_at,id`,
          [projects.map(project => project.projectId)],
        )
      ).rows
    : [];
  const progress = new Map<string, CustomerProgress>();
  for (const project of projects) {
    const submittedAt = new Date(project.createdAt);
    const timeline: CustomerProgress['timeline'] = [{ step: 'submitted', at: submittedAt }];
    let updatedAt = submittedAt;
    let noteAt: Date | null = null;
    for (const event of rows.filter(row => row.projectId === project.projectId)) {
      const step = stepOf(event);
      if (changesNote(event)) noteAt = event.createdAt;
      if (step === 'advisor')
        timeline.push({
          step: timeline.some(item => item.step === 'advisor_assigned') ? 'advisor_changed' : 'advisor_assigned',
          at: event.createdAt,
        });
      else if (step) timeline.push({ step, at: event.createdAt });
      if ((step || changesNote(event)) && event.createdAt > updatedAt) updatedAt = event.createdAt;
    }
    progress.set(project.projectId, {
      updatedAt,
      // 迁入数据可能没有发布事件，此时以项目最近更新时间作为发布时间
      note: project.publicResult ? { content: project.publicResult, publishedAt: noteAt ?? new Date(project.updatedAt) } : null,
      timeline,
    });
  }
  return progress;
}
