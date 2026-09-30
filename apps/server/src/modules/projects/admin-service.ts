import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { digest, projectError, terminalStatuses, type ProjectStatus, type QuoteInput } from './domain.js';
import { getProject, type ProjectRecord } from './repository.js';
import { operationReceipt, saveOperation } from './service.js';
import { captureScheme } from './snapshot.js';
import { calculateQuotation, localCalendarDate, type QuotationInput, type SavedQuotation } from './quotation.js';

interface Change { requestKey: string; expectedRevision: number }
export interface AssignmentInput extends Change { assigneeAdminId: string; reason: string }
export interface SchemeLinkInput extends Change { schemeCode: string; bomRevision?: number; drawingRevision?: number; confirmationNote: string }
export interface FollowUpInput extends Change {
  contactMethod: 'phone'|'email'|'customer_service'|'meeting'|'other'; contactedAt: string; content: string; nextFollowUpAt?: string;
  targetStatus?: ProjectStatus; outcome?: string; reopenReason?: string; publicResult?: string;
  quoteEvidence?: { type:'platform'; quotationRevision:number; sentAt:string; channel:string } | {type:'external_manual';reference:string;sentAt:string;channel:string};
}
export async function assertProjectAdmin(db: pg.Pool | pg.PoolClient,adminId: string) {
  const admin=(await db.query<{enabled:boolean;roles:string[]}>('SELECT enabled,roles FROM admins WHERE id=$1',[adminId])).rows[0];
  if(!admin?.enabled || !admin.roles.includes('ROLE_ADMIN')) throw projectError('ACCESS_DENIED',403);
}
function editable(project: ProjectRecord) {if(terminalStatuses.includes(project.status)) throw projectError('INVALID_STATUS_TRANSITION');}
async function change<T>(pool:pg.Pool,id:string,adminId:string,operation:string,input:Change,work:(client:pg.PoolClient,project:ProjectRecord)=>Promise<T>):Promise<T> {
  return transaction(pool,async client=>{
    await assertProjectAdmin(client,adminId);
    const hash=digest({...input,requestKey:undefined});
    const existing=await operationReceipt<T>(client,'admin',adminId,operation,id,input.requestKey,hash);
    if(existing)return existing;
    const project=await getProject(client,id,undefined,true);
    if(project.revision!==input.expectedRevision)throw projectError('PROJECT_REVISION_CHANGED');
    const result=await work(client,project);
    await saveOperation(client,'admin',adminId,operation,id,input.requestKey,hash,result);
    return result;
  });
}
async function event(client:pg.PoolClient,id:string,adminId:string,kind:string,payload:unknown) {
  const row=(await client.query<{id:string;createdAt:Date}>(`INSERT INTO project_events(project_id,actor_admin_id,kind,payload)
    VALUES($1,$2,$3,$4) RETURNING id,created_at AS "createdAt"`,[id,adminId,kind,JSON.stringify(payload)])).rows[0]!;
  return row;
}
export async function assignProject(pool:pg.Pool,id:string,adminId:string,input:AssignmentInput) {
  return change(pool,id,adminId,'assignee',input,async(client,project)=>{
    editable(project);
    const target=(await client.query<{id:string}>("SELECT id FROM admins WHERE id=$1 AND enabled AND 'ROLE_ADMIN'=ANY(roles) FOR SHARE",[input.assigneeAdminId])).rows[0];
    if(!target)throw projectError('INVALID_ASSIGNEE',422);
    if(!input.reason.trim())throw projectError('INVALID_INPUT',400);
    await client.query('UPDATE projects SET assignee_admin_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',[id,target.id]);
    await event(client,id,adminId,'assignment',{fromAdminId:project.assigneeAdminId,assigneeAdminId:target.id,reason:input.reason,revision:project.revision+1});
    return {projectId:id,revision:project.revision+1,assigneeAdminId:target.id,attribution:project.attribution};
  });
}
const transitions:Record<ProjectStatus,ProjectStatus[]>={pending:['following','closed'],following:['quoted','won','lost','closed'],quoted:['following','won','lost','closed'],won:[],lost:[],closed:[]};
export async function followUpProject(pool:pg.Pool,id:string,adminId:string,input:FollowUpInput) {
  return change(pool,id,adminId,'follow-up',input,async(client,project)=>{
    const now=Date.now();const contacted=Date.parse(input.contactedAt);
    if(!input.content.trim() || !Number.isFinite(contacted) || contacted>now+300000 || (input.nextFollowUpAt && (!Number.isFinite(Date.parse(input.nextFollowUpAt)) || Date.parse(input.nextFollowUpAt)<=contacted)))throw projectError('INVALID_INPUT',400);
    const target=input.targetStatus ?? project.status;
    if(target!==project.status) {
      const reopening=terminalStatuses.includes(project.status) && target==='following' && !!input.reopenReason?.trim();
      if(!reopening && !transitions[project.status].includes(target))throw projectError('INVALID_STATUS_TRANSITION');
      if(['won','lost','closed'].includes(target) && !input.outcome?.trim())throw projectError('OUTCOME_REQUIRED',422);
      if(target==='quoted') {
        const evidence=input.quoteEvidence;
        if(!evidence || !evidence.channel.trim() || !Number.isFinite(Date.parse(evidence.sentAt)) || Date.parse(evidence.sentAt)>now+300000)throw projectError('QUOTE_EVIDENCE_REQUIRED',422);
        if(evidence.type==='platform') {
          const quotation=await quotationRevision(client,id,evidence.quotationRevision);
          if(!quotation || quotation.completeness!=='ready' || Date.parse(evidence.sentAt)<Date.parse(quotation.createdAt)
            || localCalendarDate(evidence.sentAt,quotation.validityTimeZone)>quotation.validUntil)throw projectError('QUOTE_EVIDENCE_INVALID',422);
        } else if(!evidence.reference.trim())throw projectError('QUOTE_EVIDENCE_REQUIRED',422);
      }
    }
    const revision=project.revision+1;
    const record=await event(client,id,adminId,'follow-up',{...input,requestKey:undefined,expectedRevision:undefined,fromStatus:project.status,status:target,revision});
    await client.query('UPDATE projects SET status=$2,public_result=CASE WHEN $3::text IS NULL THEN public_result ELSE $3 END,revision=revision+1,updated_at=now() WHERE id=$1',[id,target,input.publicResult===undefined?null:input.publicResult.trim()]);
    return {followUpId:record.id,projectId:id,revision,status:target,createdAt:record.createdAt.toISOString()};
  });
}
export async function linkProjectScheme(pool:pg.Pool,id:string,adminId:string,input:SchemeLinkInput) {
  return change(pool,id,adminId,'scheme',input,async(client,project)=>{
    editable(project);
    if(project.sourceType!=='manual_request' || project.schemeCode)throw projectError('SCHEME_ALREADY_LINKED');
    if(!input.confirmationNote.trim())throw projectError('INVALID_INPUT',400);
    const captured=await captureScheme(client,input as Pick<QuoteInput,'schemeCode'|'bomRevision'|'drawingRevision'>,project.customerUserId);
    await client.query('UPDATE projects SET scheme_code=$2,scheme_snapshot=$3,materials_snapshot=$4,revision=revision+1,updated_at=now() WHERE id=$1',[id,input.schemeCode,JSON.stringify(captured.snapshot),JSON.stringify(captured.materials)]);
    for(const version of new Set(captured.versions))await client.query('INSERT INTO project_asset_versions(project_id,asset_version_id) VALUES($1,$2)',[id,version]);
    await event(client,id,adminId,'scheme',{schemeCode:input.schemeCode,confirmationNote:input.confirmationNote,revision:project.revision+1});
    return {projectId:id,revision:project.revision+1,schemeCode:input.schemeCode,bomRevision:captured.materials.bom.revision,drawingRevision:captured.materials.drawings.revision,
      materialsStatus:{bom:captured.materials.bom.status,drawings:captured.materials.drawings.status,artworks:captured.materials.artworks.status}};
  });
}
export async function quotationRevision(db:pg.Pool|pg.PoolClient,id:string,revision?:number):Promise<SavedQuotation|null> {
  const row=(await db.query<{snapshot:SavedQuotation}>(`SELECT snapshot FROM project_quotation_revisions WHERE project_id=$1 ${revision?'AND revision=$2':''} ORDER BY revision DESC LIMIT 1`,revision?[id,revision]:[id])).rows[0];
  if(revision && !row)throw projectError('RESOURCE_NOT_FOUND',404);
  return row?.snapshot ?? null;
}
export async function saveQuotation(pool:pg.Pool,id:string,adminId:string,input:QuotationInput) {
  return change(pool,id,adminId,'quotation',input,async(client,project)=>{
    editable(project);
    const previous=await quotationRevision(client,id);
    if((previous?.revision ?? 0)!==input.expectedQuotationRevision)throw projectError('QUOTATION_REVISION_CHANGED');
    const calculated=calculateQuotation(input,project.materials.bom?.items ?? []);
    const quotation:SavedQuotation={...calculated,quotationNo:`QT-${project.projectNo}`,revision:(previous?.revision ?? 0)+1,createdAt:new Date().toISOString(),createdBy:adminId};
    await client.query('INSERT INTO project_quotation_revisions(project_id,revision,quotation_no,snapshot,created_by) VALUES($1,$2,$3,$4,$5)',[id,quotation.revision,quotation.quotationNo,JSON.stringify(quotation),adminId]);
    await client.query('UPDATE projects SET revision=revision+1,updated_at=now() WHERE id=$1',[id]);
    await event(client,id,adminId,'quotation',{quotationRevision:quotation.revision,changeReason:input.changeReason,revision:project.revision+1});
    return {projectId:id,projectRevision:project.revision+1,quotation};
  });
}
