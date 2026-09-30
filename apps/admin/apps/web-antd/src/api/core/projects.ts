import { requestClient } from '#/api/request';

export type ProjectStatus='pending'|'following'|'quoted'|'won'|'lost'|'closed';
export const statusLabels:Record<ProjectStatus,string>={pending:'待跟进',following:'跟进中',quoted:'已报价',won:'已成交',lost:'未成交',closed:'已关闭'};
export interface ProjectRequest {
  exhibition?:{name:string;countryCode:string;city:string;startDate:string;endDate:string};materialBudget?:{currency:string;amount:string};
  contact:{name:string;email?:string;phone?:string;legacyDetail?:string};company?:string;customerType?:string;scopeCodes?:string[];scopeNotes?:string;notes?:string;
  originalDescription?:string;entryPoint?:string;confirmedRequirements?:Record<string,unknown>;requirementContext?:{originalDescription:string;confirmedRequirements:Record<string,unknown>};
  unresolvedQuestions?:string[];matchingSummary?:Record<string,unknown>;legacyIncomplete?:boolean;
}
export interface Asset {versionId:string;name:string;filename:string;type:string}
export interface BomItem {id:string;ordinal:number;productName:string;productModel:string|null;specificationMm:string|null;quantity:string;pricingUnit:string;erpCode:string|null}
export interface Project {
  projectId:string;projectNo:string;requestNo:string;sourceType:'quote_request'|'manual_request';customerUserId:string|null;assigneeAdminId:string;assigneeName:string;
  attribution:Record<string,unknown>;status:ProjectStatus;revision:number;schemeCode:string|null;request:ProjectRequest;publicResult:string|null;createdAt:string;updatedAt:string;
  schemeSnapshot:{code:string;name:string;revision:number;renderings:Asset[];selectedTheme:{asset:Asset}|null}|null;
  materials:{bom?:{status:string;revision:number|null;items:BomItem[]};drawings?:{status:string;assets:Asset[]};artworks?:{status:string;assets:Asset[]}};
}
export interface ProjectEvent {id:string;kind:string;actorName:string|null;payload:Record<string,unknown>;createdAt:string}
export interface PageResult<T> {items:T[];total:number;page:number;pageSize:number}
export interface QuotationItem {clientLineId:string;kind:'material'|'graphic'|'transport'|'installation'|'other';bomItemId?:string;name:string;model?:string;specificationMm?:string;
  quantity:string;pricingUnit:string;unitPrice:string|null;erpCode?:string;notes?:string;differenceReason?:string;lineAmount?:string|null}
export interface Quotation {quotationNo:string;revision:number;currency:string;currencyScale:number;roundingMode:string;priceBasis:'included'|'excluded'|'not_applicable';
  validUntil:string;validityTimeZone:string;items:QuotationItem[];terms:string;inclusions:string;exclusions:string;changeReason:string;totalAmount:string|null;
  completeness:'incomplete'|'ready';validationIssues:string[];createdAt:string}
export interface ProjectDetail extends Project {events:PageResult<ProjectEvent>;quotation:Quotation|null}
export interface Change {requestKey:string;expectedRevision:number}
export interface FollowUp extends Change {contactMethod:string;contactedAt:string;content:string;targetStatus?:ProjectStatus;nextFollowUpAt?:string;outcome?:string;reopenReason?:string;publicResult?:string;
  quoteEvidence?:{type:'platform';quotationRevision:number;sentAt:string;channel:string}|{type:'external_manual';reference:string;sentAt:string;channel:string}}
export type QuotationInput=Omit<Quotation,'quotationNo'|'revision'|'currencyScale'|'roundingMode'|'totalAmount'|'completeness'|'validationIssues'|'createdAt'> & Change & {expectedQuotationRevision:number};
export interface ProjectQuery {page?:number;pageSize?:number;projectNo?:string;schemeCode?:string;sourceType?:string;status?:ProjectStatus;exhibitionName?:string;city?:string;customerName?:string;assigneeAdminId?:string}
export const listProjectsApi=(params:ProjectQuery)=>requestClient.get<PageResult<Project>>('/v1/admin/projects',{params});
export const getProjectApi=(id:string)=>requestClient.get<ProjectDetail>(`/v1/admin/projects/${id}`);
export const getAssigneesApi=()=>requestClient.get<{id:string;name:string}[]>('/v1/admin/project-assignees');
export const assignProjectApi=(id:string,input:Change & {assigneeAdminId:string;reason:string})=>requestClient.put(`/v1/admin/projects/${id}/assignee`,input);
export const followUpApi=(id:string,input:FollowUp)=>requestClient.post(`/v1/admin/projects/${id}/follow-ups`,input);
export const linkSchemeApi=(id:string,input:Change & {schemeCode:string;confirmationNote:string})=>requestClient.put(`/v1/admin/projects/${id}/scheme`,input);
export const quotationApi=(id:string,revision?:number)=>requestClient.get<{projectId:string;projectRevision:number;quotation:Quotation|null}>(`/v1/admin/projects/${id}/quotation`,{params:{revision}});
export const saveQuotationApi=(id:string,input:QuotationInput)=>requestClient.put<{projectId:string;projectRevision:number;quotation:Quotation}>(`/v1/admin/projects/${id}/quotation`,input);
export const quotationDownloadApi=(id:string,revision:number)=>requestClient.get<Blob>(`/v1/admin/projects/${id}/quotation/download`,{params:{revision},responseType:'blob',responseReturn:'body'});
export const assetDownloadApi=(id:string,version:string)=>requestClient.get<{downloadUrl:string;filename:string}>(`/v1/admin/projects/${id}/assets/${version}/download`);
export const projectEventsApi=(id:string,page:number)=>requestClient.get<PageResult<ProjectEvent>>(`/v1/admin/projects/${id}/events`,{params:{page,pageSize:20}});
