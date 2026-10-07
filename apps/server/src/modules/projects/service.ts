import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { digest, normalizeQuote, normalizeManual, projectError, type ManualInput, type QuoteInput, type Receipt } from './domain.js';
import { captureScheme } from './snapshot.js';
import { loadCatalog } from '../selection/repository.js';
import { validateRequirement } from '../selection/domain.js';
import { configuredAssignee } from './assignment.js';
import { enqueueReceiptEmail } from './receipt-emails.js';
import { DEFAULT_MESSAGE_LOCALE, type MessageLocale } from '../selection/messages/index.js';

const ANONYMOUS_ACTOR = '00000000-0000-0000-0000-000000000000';
// 未登录提交以联系邮箱作为认领凭据（灵通注册会验证邮箱），因此匿名提交必须提供邮箱
function submitter(userId: string | null, contact: QuoteInput['contact']) {
  if (userId) return { actorType: 'client', actorId: userId, claimEmail: null };
  if (!contact.email) throw projectError('CLAIM_EMAIL_REQUIRED',400);
  return { actorType: 'anonymous', actorId: ANONYMOUS_ACTOR, claimEmail: contact.email.toLowerCase() };
}
export async function createManualProject(pool: pg.Pool,userId: string | null,raw: ManualInput,locale: MessageLocale = DEFAULT_MESSAGE_LOCALE) {
  const input = normalizeManual(raw); const hash = digest({...input,requestKey:undefined});
  const { actorType, actorId, claimEmail } = submitter(userId,input.contact);
  return transaction(pool,async client=>{
    const existing = await operationReceipt<Record<string,unknown>>(client,actorType,actorId,'manual.create','collection',input.requestKey,hash);
    if(existing) return {replayed:true,receipt:existing};
    const catalog=await loadCatalog(client);
    validateRequirement(input.confirmedRequirements,catalog);
    if(input.parsedRequirements)validateRequirement(input.parsedRequirements,catalog);
    const assignee = await configuredAssignee(client); const id=randomUUID(); const requestNo=`MR-${id.toUpperCase()}`;
    const row=(await client.query<{projectNo:string;createdAt:Date}>(`INSERT INTO projects(id,request_no,source_type,customer_user_id,assignee_admin_id,request_snapshot,claim_email)
      VALUES($1,$2,'manual_request',$3,$4,$5,$6) RETURNING project_no AS "projectNo",created_at AS "createdAt"`,[id,requestNo,userId,assignee,JSON.stringify({...input,requestKey:undefined}),claimEmail])).rows[0]!;
    const event=(await client.query<{id:string}>("INSERT INTO project_events(project_id,kind,payload) VALUES($1,'accepted',$2) RETURNING id",[id,JSON.stringify({assigneeAdminId:assignee,revision:1})])).rows[0]!;
    await client.query('INSERT INTO project_notification_outbox(project_id,event_id) VALUES($1,$2)',[id,event.id]);
    if(input.contact.email) await enqueueReceiptEmail(client,{projectId:id,recipient:input.contact.email,locale,accountBound:userId!==null});
    const receipt={manualRequestId:id,requestNo,projectId:id,projectNo:row.projectNo,status:'pending',revision:1,schemeCode:null,createdAt:row.createdAt.toISOString()};
    await saveOperation(client,actorType,actorId,'manual.create','collection',input.requestKey,hash,receipt);
    return {replayed:false,receipt};
  });
}
export async function operationReceipt<T>(client: pg.PoolClient, actorType: string, actorId: string, operation: string, target: string, key: string, hash: string): Promise<T | null> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([actorType,actorId,operation,target,key])]);
  const row = (await client.query<{ payloadHash: string; receipt: T }>(`SELECT payload_hash AS "payloadHash",receipt FROM project_operations
    WHERE actor_type=$1 AND actor_id=$2 AND operation=$3 AND target=$4 AND request_key=$5`, [actorType,actorId,operation,target,key])).rows[0];
  if (!row) return null;
  if (row.payloadHash !== hash) throw projectError('IDEMPOTENCY_CONFLICT');
  return row.receipt;
}
export async function saveOperation(client: pg.PoolClient, actorType: string, actorId: string, operation: string, target: string, key: string, hash: string, receipt: unknown) {
  await client.query(`INSERT INTO project_operations(actor_type,actor_id,operation,target,request_key,payload_hash,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [actorType,actorId,operation,target,key,hash,JSON.stringify(receipt)]);
}
export async function createQuoteRequest(pool: pg.Pool, userId: string | null, raw: QuoteInput, locale: MessageLocale = DEFAULT_MESSAGE_LOCALE): Promise<{ replayed: boolean; receipt: Receipt }> {
  const input = normalizeQuote(raw);
  // 主题效果与画稿属于用户私有生成结果，只能由登录用户引用
  if (!userId && (input.themeSelection || input.artworkJobId)) throw projectError('AUTH_REQUIRED', 401);
  const hash = digest({ ...input, requestKey: undefined });
  const { actorType, actorId, claimEmail } = submitter(userId, input.contact);
  return transaction(pool, async client => {
    const existing = await operationReceipt<Receipt>(client, actorType, actorId, 'quote.create', 'collection', input.requestKey, hash);
    if (existing) return { replayed: true, receipt: existing };
    const { snapshot, materials, versions, matchingSummary } = await captureScheme(client, input, userId);
    const assignee = await configuredAssignee(client);
    const id = randomUUID();
    const requestNo = `QR-${id.toUpperCase()}`;
    const row = (await client.query<{ projectNo: string; createdAt: Date }>(`INSERT INTO projects(id,request_no,source_type,customer_user_id,assignee_admin_id,scheme_code,request_snapshot,scheme_snapshot,materials_snapshot,claim_email)
      VALUES($1,$2,'quote_request',$3,$4,$5,$6,$7,$8,$9) RETURNING project_no AS "projectNo",created_at AS "createdAt"`,
      [id,requestNo,userId,assignee,input.schemeCode,JSON.stringify({ ...input, requestKey: undefined, matchingSummary }),JSON.stringify(snapshot),JSON.stringify(materials),claimEmail])).rows[0]!;
    for (const version of new Set(versions)) await client.query('INSERT INTO project_asset_versions(project_id,asset_version_id) VALUES($1,$2)', [id,version]);
    const event = (await client.query<{ id: string }>(`INSERT INTO project_events(project_id,kind,payload) VALUES($1,'accepted',$2) RETURNING id`, [id,JSON.stringify({ assigneeAdminId: assignee, revision: 1 })])).rows[0]!;
    await client.query('INSERT INTO project_notification_outbox(project_id,event_id) VALUES($1,$2)', [id,event.id]);
    if (input.contact.email) await enqueueReceiptEmail(client, { projectId: id, recipient: input.contact.email, locale, accountBound: userId !== null });
    const receipt: Receipt = { quoteRequestId: id, requestNo, projectId: id, projectNo: row.projectNo, status: 'pending', revision: 1, schemeCode: input.schemeCode,
      bomRevision: materials.bom.revision, drawingRevision: materials.drawings.revision,
      materialsStatus: { bom: materials.bom.status, drawings: materials.drawings.status, artworks: materials.artworks.status }, createdAt: row.createdAt.toISOString() };
    await saveOperation(client,actorType,actorId,'quote.create','collection',input.requestKey,hash,receipt);
    return { replayed: false, receipt };
  });
}
