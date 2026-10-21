import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { digest, projectError, terminalStatuses, type ContactMethod, type ProjectStatus, type QuoteInput } from './domain.js';
import { getProject, type ProjectRecord } from './repository.js';
import { operationReceipt, saveOperation } from './service.js';
import { captureScheme } from './snapshot.js';
import { calculateQuotation, localCalendarDate, type QuotationInput, type SavedQuotation } from './quotation.js';
import { resolveAdminPermissions } from '../identity/roles.js';
import { eligibleAssignee, getAssignmentConfig } from './assignment.js';

export interface AssignmentConfigInput {
  defaultAssigneeAdminId: string | null;
  expectedRevision: number;
}

export async function saveAssignmentConfig(pool: pg.Pool, adminId: string, input: AssignmentConfigInput) {
  return transaction(pool, async client => {
    await assertProjectAdmin(client, adminId, 'projects.assign');
    const current = (
      await client.query<{ id: string | null; revision: number }>(
        'SELECT default_assignee_admin_id AS id,revision FROM project_assignment_config WHERE id=true FOR UPDATE',
      )
    ).rows[0];
    if (!current) throw new Error('project_assignment_config row is missing');
    if (current.revision !== input.expectedRevision) throw projectError('ASSIGNMENT_CONFIG_CHANGED');
    if (input.defaultAssigneeAdminId !== null && !(await eligibleAssignee(client, input.defaultAssigneeAdminId))) {
      throw projectError('INVALID_ASSIGNEE', 422);
    }
    await client.query(
      `UPDATE project_assignment_config SET default_assignee_admin_id=$1,
      revision=revision+1,updated_by=$2,updated_at=now() WHERE id=true`,
      [input.defaultAssigneeAdminId, adminId],
    );
    await client.query(
      `INSERT INTO admin_audit_logs(admin_id,action,target_type,target_id,detail)
      VALUES($1,'project.assignment-config.update','project_assignment_config','default',$2::jsonb)`,
      [adminId, JSON.stringify({ before: current.id, after: input.defaultAssigneeAdminId, revision: current.revision + 1 })],
    );
    return getAssignmentConfig(client);
  });
}

interface Change {
  requestKey: string;
  expectedRevision: number;
}
export interface AssignmentInput extends Change {
  assigneeAdminId: string;
  reason: string;
}
export interface SchemeLinkInput extends Change {
  schemeCode: string;
  bomRevision?: number;
  drawingRevision?: number;
  confirmationNote: string;
}
export interface FollowUpInput extends Change {
  contactMethod: ContactMethod;
  contactedAt: string;
  content: string;
  nextFollowUpAt?: string;
  targetStatus?: ProjectStatus;
  outcome?: string;
  reopenReason?: string;
  quoteEvidence?:
    | { type: 'platform'; quotationRevision: number; sentAt: string; channel: ContactMethod }
    | { type: 'external_manual'; reference: string; sentAt: string; channel: ContactMethod };
}
export interface PublicResultInput extends Change {
  publicResult: string;
}
/** 保存报价时一并登记已发送；sentAt 省略时取保存时间 */
export interface MarkSentInput {
  sentAt?: string;
  channel: ContactMethod;
}
// 联系与发送时间允许比服务器时钟快 5 分钟，避免客户端时钟偏差误判
const CLOCK_SKEW_MS = 300000;
export async function assertProjectAdmin(db: pg.Pool | pg.PoolClient, adminId: string, permission = 'projects.follow-up') {
  const admin = (await db.query<{ enabled: boolean; roles: string[] }>('SELECT enabled,roles FROM admins WHERE id=$1', [adminId])).rows[0];
  if (!admin?.enabled) throw projectError('ACCESS_DENIED', 403);
  const permissions = await resolveAdminPermissions(db, admin.roles);
  if (!permissions.includes('projects.read') || !permissions.includes(permission)) throw projectError('ACCESS_DENIED', 403);
}
function editable(project: ProjectRecord) {
  if (terminalStatuses.includes(project.status)) throw projectError('INVALID_STATUS_TRANSITION');
}
interface ChangeOptions {
  /** 待分配项目不能执行该操作（跟进、报价、关联方案） */
  requireAssignee?: boolean;
}
async function change<T>(
  pool: pg.Pool,
  id: string,
  adminId: string,
  operation: string,
  input: Change | Omit<Change, 'expectedRevision'>,
  work: (client: pg.PoolClient, project: ProjectRecord) => Promise<T>,
  options: ChangeOptions = {},
): Promise<T> {
  return transaction(pool, async client => {
    const permissions: Record<string, string> = {
      assignee: 'projects.assign',
      claim: 'projects.follow-up',
      'follow-up': 'projects.follow-up',
      'public-result': 'projects.follow-up',
      scheme: 'projects.link-scheme',
      quotation: 'projects.quotation',
    };
    const permission = permissions[operation];
    if (!permission) throw projectError('ACCESS_DENIED', 403);
    await assertProjectAdmin(client, adminId, permission);
    const hash = digest({ ...input, requestKey: undefined });
    const existing = await operationReceipt<T>(client, 'admin', adminId, operation, id, input.requestKey, hash);
    if (existing) return existing;
    const project = await getProject(client, id, undefined, true);
    // 不带 expectedRevision 的操作（领取）以行锁内的实时状态为准
    if ('expectedRevision' in input && project.revision !== input.expectedRevision) throw projectError('PROJECT_REVISION_CHANGED');
    if (options.requireAssignee && !project.assigneeAdminId) throw projectError('ASSIGNEE_REQUIRED');
    const result = await work(client, project);
    await saveOperation(client, 'admin', adminId, operation, id, input.requestKey, hash, result);
    return result;
  });
}
// clock_timestamp 让同一事务内先后写入的事件（如报价修订后紧跟发送记录）在时间线上保持顺序
async function event(client: pg.PoolClient, id: string, adminId: string, kind: string, payload: unknown) {
  const row = (
    await client.query<{ id: string; createdAt: Date }>(
      `INSERT INTO project_events(project_id,actor_admin_id,kind,payload,created_at)
    VALUES($1,$2,$3,$4,clock_timestamp()) RETURNING id,created_at AS "createdAt"`,
      [id, adminId, kind, JSON.stringify(payload)],
    )
  ).rows[0]!;
  return row;
}
export async function assignProject(pool: pg.Pool, id: string, adminId: string, input: AssignmentInput) {
  return change(pool, id, adminId, 'assignee', input, async (client, project) => {
    // 终态项目也可直接改派，状态不变
    if (!(await eligibleAssignee(client, input.assigneeAdminId))) throw projectError('INVALID_ASSIGNEE', 422);
    if (!input.reason.trim()) throw projectError('INVALID_INPUT', 400);
    await client.query('UPDATE projects SET assignee_admin_id=$2,revision=revision+1,updated_at=now() WHERE id=$1', [
      id,
      input.assigneeAdminId,
    ]);
    const record = await event(client, id, adminId, 'assignment', {
      fromAdminId: project.assigneeAdminId,
      assigneeAdminId: input.assigneeAdminId,
      reason: input.reason,
      revision: project.revision + 1,
    });
    // 新承接人收到只有本人可见的通知；分配给自己时不通知
    if (input.assigneeAdminId !== adminId)
      await client.query(
        "INSERT INTO project_notification_outbox(project_id,event_id,audience,recipient_admin_id) VALUES($1,$2,'recipient',$3)",
        [id, record.id, input.assigneeAdminId],
      );
    return { projectId: id, revision: project.revision + 1, assigneeAdminId: input.assigneeAdminId };
  });
}
/** 符合承接条件的人领取待分配项目；并发领取先到先得，不校验列表里可能已过期的修订号 */
export async function claimProject(pool: pg.Pool, id: string, adminId: string, input: { requestKey: string }) {
  return change(pool, id, adminId, 'claim', input, async (client, project) => {
    if (project.assigneeAdminId)
      throw Object.assign(projectError('PROJECT_ALREADY_ASSIGNED'), {
        details: { assigneeAdminId: project.assigneeAdminId, assigneeName: project.assigneeName },
      });
    await client.query('UPDATE projects SET assignee_admin_id=$2,revision=revision+1,updated_at=now() WHERE id=$1', [id, adminId]);
    await event(client, id, adminId, 'assignment', {
      fromAdminId: null,
      assigneeAdminId: adminId,
      selfClaimed: true,
      revision: project.revision + 1,
    });
    return { projectId: id, revision: project.revision + 1, assigneeAdminId: adminId };
  });
}
const transitions: Record<ProjectStatus, ProjectStatus[]> = {
  pending: ['following', 'quoted', 'closed'],
  following: ['quoted', 'won', 'lost', 'closed'],
  quoted: ['following', 'won', 'lost', 'closed'],
  won: [],
  lost: [],
  closed: [],
};
/** 平台报价修订能否作为发送依据：完整、发送时间不早于修订创建且在有效期内 */
export function assertPlatformEvidence(quotation: SavedQuotation | null, sentAt: string) {
  if (
    !quotation ||
    quotation.completeness !== 'ready' ||
    Date.parse(sentAt) < Date.parse(quotation.createdAt) ||
    localCalendarDate(sentAt, quotation.validityTimeZone) > quotation.validUntil
  )
    throw projectError('QUOTE_EVIDENCE_INVALID', 422);
}
/** 客户可见结果独立于跟进，终态项目也可更新；空字符串表示撤下 */
export async function updatePublicResult(pool: pg.Pool, id: string, adminId: string, input: PublicResultInput) {
  return change(pool, id, adminId, 'public-result', input, async (client, project) => {
    const publicResult = input.publicResult.trim() || null;
    await client.query('UPDATE projects SET public_result=$2,revision=revision+1,updated_at=now() WHERE id=$1', [id, publicResult]);
    await event(client, id, adminId, 'public-result', { publicResult, revision: project.revision + 1 });
    return { projectId: id, revision: project.revision + 1, publicResult };
  });
}
/** 当前状态可追加跟进到的目标状态；终态只能填写重开原因回到跟进中。 */
export function statusTransitions(status: ProjectStatus): ProjectStatus[] {
  return terminalStatuses.includes(status) ? ['following'] : transitions[status];
}
export async function followUpProject(pool: pg.Pool, id: string, adminId: string, input: FollowUpInput) {
  return change(
    pool,
    id,
    adminId,
    'follow-up',
    input,
    async (client, project) => {
      const now = Date.now();
      const contacted = Date.parse(input.contactedAt);
      if (
        !input.content.trim() ||
        !Number.isFinite(contacted) ||
        contacted > now + CLOCK_SKEW_MS ||
        (input.nextFollowUpAt && (!Number.isFinite(Date.parse(input.nextFollowUpAt)) || Date.parse(input.nextFollowUpAt) <= contacted))
      )
        throw projectError('INVALID_INPUT', 400);
      const target = input.targetStatus ?? project.status;
      if (target !== project.status) {
        const reopening = terminalStatuses.includes(project.status) && target === 'following' && !!input.reopenReason?.trim();
        if (!reopening && !transitions[project.status].includes(target)) throw projectError('INVALID_STATUS_TRANSITION');
        if (['won', 'lost', 'closed'].includes(target) && !input.outcome?.trim()) throw projectError('OUTCOME_REQUIRED', 422);
        if (target === 'quoted') {
          const evidence = input.quoteEvidence;
          if (!evidence || !Number.isFinite(Date.parse(evidence.sentAt)) || Date.parse(evidence.sentAt) > now + CLOCK_SKEW_MS)
            throw projectError('QUOTE_EVIDENCE_REQUIRED', 422);
          if (evidence.type === 'platform')
            assertPlatformEvidence(await quotationRevision(client, id, evidence.quotationRevision), evidence.sentAt);
          else if (!evidence.reference.trim()) throw projectError('QUOTE_EVIDENCE_REQUIRED', 422);
        }
      }
      const revision = project.revision + 1;
      const record = await event(client, id, adminId, 'follow-up', {
        ...input,
        requestKey: undefined,
        expectedRevision: undefined,
        fromStatus: project.status,
        status: target,
        revision,
      });
      await client.query('UPDATE projects SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1', [id, target]);
      return { followUpId: record.id, projectId: id, revision, status: target, createdAt: record.createdAt.toISOString() };
    },
    { requireAssignee: true },
  );
}
export async function linkProjectScheme(pool: pg.Pool, id: string, adminId: string, input: SchemeLinkInput) {
  return change(
    pool,
    id,
    adminId,
    'scheme',
    input,
    async (client, project) => {
      if (project.schemeCode || project.sourceType !== 'manual_request') {
        // 重新关联：只允许未结束、还没有任何报价修订的人工需求，旧方案冻结的资料版本一并替换
        const quoted = (await client.query('SELECT 1 FROM project_quotation_revisions WHERE project_id=$1 LIMIT 1', [id])).rowCount;
        if (project.sourceType !== 'manual_request' || terminalStatuses.includes(project.status) || quoted)
          throw projectError('SCHEME_RELINK_BLOCKED');
      } else editable(project);
      if (!input.confirmationNote.trim()) throw projectError('INVALID_INPUT', 400);
      const captured = await captureScheme(
        client,
        input as Pick<QuoteInput, 'schemeCode' | 'bomRevision' | 'drawingRevision'>,
        project.customerUserId,
      );
      await client.query(
        'UPDATE projects SET scheme_code=$2,scheme_snapshot=$3,materials_snapshot=$4,revision=revision+1,updated_at=now() WHERE id=$1',
        [id, input.schemeCode, JSON.stringify(captured.snapshot), JSON.stringify(captured.materials)],
      );
      if (project.schemeCode) await client.query('DELETE FROM project_asset_versions WHERE project_id=$1', [id]);
      for (const version of new Set(captured.versions))
        await client.query('INSERT INTO project_asset_versions(project_id,asset_version_id) VALUES($1,$2)', [id, version]);
      await event(client, id, adminId, 'scheme', {
        schemeCode: input.schemeCode,
        fromSchemeCode: project.schemeCode,
        confirmationNote: input.confirmationNote,
        revision: project.revision + 1,
      });
      return {
        projectId: id,
        revision: project.revision + 1,
        schemeCode: input.schemeCode,
        bomRevision: captured.materials.bom.revision,
        drawingRevision: captured.materials.drawings.revision,
        materialsStatus: {
          bom: captured.materials.bom.status,
          drawings: captured.materials.drawings.status,
          artworks: captured.materials.artworks.status,
        },
      };
    },
    { requireAssignee: true },
  );
}
export async function quotationRevision(db: pg.Pool | pg.PoolClient, id: string, revision?: number): Promise<SavedQuotation | null> {
  const row = (
    await db.query<{ snapshot: SavedQuotation }>(
      `SELECT snapshot FROM project_quotation_revisions WHERE project_id=$1 ${revision ? 'AND revision=$2' : ''} ORDER BY revision DESC LIMIT 1`,
      revision ? [id, revision] : [id],
    )
  ).rows[0];
  if (revision && !row) throw projectError('RESOURCE_NOT_FOUND', 404);
  return row?.snapshot ?? null;
}
/**
 * 保存报价修订；带 markSent 时在同一事务内登记已发送并转为已报价（已是已报价则只记录一次发送）。
 * 发送依据校验不通过时整体回滚，修订也不保存。
 */
export async function saveQuotation(pool: pg.Pool, id: string, adminId: string, input: QuotationInput & { markSent?: MarkSentInput }) {
  return change(
    pool,
    id,
    adminId,
    'quotation',
    input,
    async (client, project) => {
      editable(project);
      if (input.markSent) await assertProjectAdmin(client, adminId, 'projects.follow-up');
      const previous = await quotationRevision(client, id);
      if ((previous?.revision ?? 0) !== input.expectedQuotationRevision) throw projectError('QUOTATION_REVISION_CHANGED');
      const { markSent, ...quotationInput } = input;
      const calculated = calculateQuotation(quotationInput, project.materials.bom?.items ?? []);
      const quotation: SavedQuotation = {
        ...calculated,
        quotationNo: `QT-${project.projectNo}`,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: new Date().toISOString(),
        createdBy: adminId,
      };
      await client.query(
        'INSERT INTO project_quotation_revisions(project_id,revision,quotation_no,snapshot,created_by) VALUES($1,$2,$3,$4,$5)',
        [id, quotation.revision, quotation.quotationNo, JSON.stringify(quotation), adminId],
      );
      const revision = project.revision + 1;
      await event(client, id, adminId, 'quotation', {
        quotationRevision: quotation.revision,
        changeReason: input.changeReason,
        revision,
      });
      let status = project.status;
      if (markSent) {
        const sentAt = markSent.sentAt ?? quotation.createdAt;
        if (!Number.isFinite(Date.parse(sentAt)) || Date.parse(sentAt) > Date.now() + CLOCK_SKEW_MS)
          throw projectError('QUOTE_EVIDENCE_REQUIRED', 422);
        assertPlatformEvidence(quotation, sentAt);
        status = 'quoted';
        await event(client, id, adminId, 'follow-up', {
          contactMethod: markSent.channel,
          contactedAt: sentAt,
          content: `发送报价 ${quotation.quotationNo} r${quotation.revision}`,
          targetStatus: status,
          quoteEvidence: { type: 'platform', quotationRevision: quotation.revision, sentAt, channel: markSent.channel },
          fromStatus: project.status,
          status,
          revision,
        });
      }
      await client.query('UPDATE projects SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1', [id, status]);
      return { projectId: id, projectRevision: revision, status, quotation };
    },
    { requireAssignee: true },
  );
}
/** 报价修订列表（倒序），供跟进弹窗与报价编辑器选择历史修订 */
export async function listQuotationRevisions(db: pg.Pool | pg.PoolClient, id: string) {
  return (
    await db.query<{
      revision: number;
      completeness: 'incomplete' | 'ready';
      currency: string;
      totalAmount: string | null;
      validUntil: string;
      validityTimeZone: string;
      createdAt: Date;
      createdByName: string | null;
    }>(
      `SELECT r.revision,r.snapshot->>'completeness' AS completeness,r.snapshot->>'currency' AS currency,
      r.snapshot->>'totalAmount' AS "totalAmount",r.snapshot->>'validUntil' AS "validUntil",
      r.snapshot->>'validityTimeZone' AS "validityTimeZone",r.created_at AS "createdAt",coalesce(a.nickname,a.username) AS "createdByName"
    FROM project_quotation_revisions r LEFT JOIN admins a ON a.id=r.created_by WHERE r.project_id=$1 ORDER BY r.revision DESC`,
      [id],
    )
  ).rows;
}
