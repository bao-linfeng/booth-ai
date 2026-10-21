import { requestClient } from '#/api/request';

export type ProjectStatus =
  | 'closed'
  | 'following'
  | 'lost'
  | 'pending'
  | 'quoted'
  | 'won';
export const statusLabels: Record<ProjectStatus, string> = {
  pending: '待跟进',
  following: '跟进中',
  quoted: '已报价',
  won: '已成交',
  lost: '未成交',
  closed: '已关闭',
};
export const projectEventLabels: Record<string, string> = {
  accepted: '受理',
  assignment: '分配',
  scheme: '确认关联方案',
  'follow-up': '联系跟进',
  quotation: '报价修订',
  legacy_import: '历史迁入',
  'public-result': '更新客户进度',
  claimed: '客户登录认领',
  'quotation-email': '报价邮件',
};
export interface ProjectRequest {
  exhibition?: {
    name: string;
    countryCode: string;
    city: string;
    startDate: string;
    endDate: string;
  };
  materialBudget?: { currency: string; amount: string };
  contact: {
    name: string;
    email?: string;
    phone?: string;
    legacyDetail?: string;
  };
  company?: string;
  customerType?: string;
  scopeCodes?: string[];
  scopeNotes?: string;
  notes?: string;
  originalDescription?: string;
  entryPoint?: string;
  confirmedRequirements?: Record<string, unknown>;
  requirementContext?: {
    originalDescription: string;
    confirmedRequirements: Record<string, unknown>;
  };
  unresolvedQuestions?: string[];
  matchingSummary?: MatchingSummary;
  legacyIncomplete?: boolean;
}
export interface MatchingSummary {
  matchType: 'direct' | 'random' | 'reference' | 'unmatched';
  differences: {
    actual: string;
    field: string;
    reason: string;
    requested: string;
  }[];
  pendingConfirmations: { field?: string; message: string; type: string }[];
}
export interface Asset {
  versionId: string;
  name: string;
  filename: string;
  mimeType?: string;
  type: string;
}
export interface BomItem {
  id: string;
  ordinal: number;
  productName: string;
  productModel: null | string;
  specificationMm: null | string;
  quantity: string;
  pricingUnit: string;
  erpCode: null | string;
}
export interface Project {
  projectId: string;
  projectNo: string;
  requestNo: string;
  sourceType: 'manual_request' | 'quote_request';
  customerUserId: null | string;
  /** 待分配项目为 null */
  assigneeAdminId: null | string;
  assigneeName: null | string;
  assigneeStatus: AssigneeStatus;
  status: ProjectStatus;
  revision: number;
  schemeCode: null | string;
  request: ProjectRequest;
  publicResult: null | string;
  /** 最新一条跟进记录约定的下次跟进时间 */
  nextFollowUpAt: null | string;
  createdAt: string;
  updatedAt: string;
  schemeSnapshot: null | {
    code: string;
    name: string;
    revision: number;
    renderings: Asset[];
    selectedTheme: null | { asset: Asset };
  };
  materials: {
    bom?: { status: string; revision: null | number; items: BomItem[] };
    drawings?: { status: string; assets: Asset[] };
    artworks?: { status: string; assets: Asset[] };
  };
}
export type AssigneeStatus =
  | 'active'
  | 'disabled'
  | 'permission_revoked'
  | 'unassigned';
export const assigneeStatusLabels: Record<AssigneeStatus, string> = {
  active: '有效',
  disabled: '已停用',
  permission_revoked: '缺少项目查看或跟进权限',
  unassigned: '待分配',
};
/** 受理时进入待分配池的原因（accepted 事件 payload.poolReason） */
export const poolReasonLabels: Record<string, string> = {
  unconfigured: '未配置默认承接人',
  disabled: '默认承接人已停用',
  permission_revoked: '默认承接人缺少权限',
};
export interface AssignmentConfig {
  defaultAssigneeAdminId: null | string;
  assigneeName: null | string;
  status: 'unconfigured' | Exclude<AssigneeStatus, 'unassigned'>;
  revision: number;
  updatedAt: string;
}
export const getAssignmentConfigApi = () =>
  requestClient.get<AssignmentConfig>('/v1/admin/project-assignment-config');
export const saveAssignmentConfigApi = (input: {
  defaultAssigneeAdminId: null | string;
  expectedRevision: number;
}) =>
  requestClient.put<AssignmentConfig>(
    '/v1/admin/project-assignment-config',
    input,
  );
export interface ProjectEvent {
  id: string;
  kind: string;
  actorName: null | string;
  /** 分配类事件中的承接人与原承接人名称 */
  assigneeName: null | string;
  fromAssigneeName: null | string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface QuotationItem {
  clientLineId: string;
  kind: 'graphic' | 'installation' | 'material' | 'other' | 'transport';
  bomItemId?: string;
  name: string;
  model?: string;
  specificationMm?: string;
  quantity: string;
  pricingUnit: string;
  unitPrice: null | string;
  erpCode?: string;
  notes?: string;
  differenceReason?: string;
  lineAmount?: null | string;
}
export interface Quotation {
  quotationNo: string;
  revision: number;
  currency: string;
  currencyScale: number;
  roundingMode: string;
  priceBasis: 'excluded' | 'included' | 'not_applicable';
  validUntil: string;
  validityTimeZone: string;
  items: QuotationItem[];
  terms: string;
  inclusions: string;
  exclusions: string;
  changeReason: string;
  totalAmount: null | string;
  completeness: 'incomplete' | 'ready';
  validationIssues: string[];
  createdAt: string;
}
export interface ProjectDetail extends Project {
  events: ProjectEvent[];
  quotation: null | Quotation;
  /** 追加跟进可选的目标状态；终态只含重开后的 following */
  statusTransitions: ProjectStatus[];
  /** 确认条件中字典项 ID → 名称 */
  requirementOptionLabels: Record<string, string>;
}
export interface Change {
  requestKey: string;
  expectedRevision: number;
}
/** 联系类型，也用作报价发送渠道 */
export type ContactMethod =
  | 'customer_service'
  | 'email'
  | 'meeting'
  | 'other'
  | 'phone';
export interface FollowUp extends Change {
  contactMethod: ContactMethod;
  contactedAt: string;
  content: string;
  targetStatus?: ProjectStatus;
  nextFollowUpAt?: string;
  outcome?: string;
  reopenReason?: string;
  quoteEvidence?:
    | {
        type: 'external_manual';
        reference: string;
        sentAt: string;
        channel: ContactMethod;
      }
    | {
        type: 'platform';
        quotationRevision: number;
        sentAt: string;
        channel: ContactMethod;
      };
}
/** 报价修订摘要（修订列表接口） */
export interface QuotationRevisionSummary {
  revision: number;
  completeness: 'incomplete' | 'ready';
  currency: string;
  totalAmount: null | string;
  validUntil: string;
  validityTimeZone: string;
  createdAt: string;
  createdByName: null | string;
}
export type QuotationInput = {
  expectedQuotationRevision: number;
  /** 保存后由系统邮件把报价单发给客户联系邮箱并转为已报价；邮件进入发送队列 */
  sendEmail?: boolean;
} & Change &
  Omit<
    Quotation,
    | 'completeness'
    | 'createdAt'
    | 'currencyScale'
    | 'quotationNo'
    | 'revision'
    | 'roundingMode'
    | 'totalAmount'
    | 'validationIssues'
  >;
export interface ProjectQuery {
  page?: number;
  pageSize?: number;
  projectNo?: string;
  schemeCode?: string;
  sourceType?: string;
  status?: ProjectStatus;
  exhibitionName?: string;
  city?: string;
  customerName?: string;
  assigneeAdminId?: string;
  /** 只看当前登录管理员负责的项目 */
  mine?: boolean;
  /** 未结束项目中下次跟进已逾期 / 今天到期 */
  followUp?: 'overdue' | 'today';
  /** unassigned：待分配；needs_assignment：待分配或承接人失效且未结束 */
  assignment?: 'needs_assignment' | 'unassigned';
}
export const listProjectsApi = (params: ProjectQuery) =>
  requestClient.get<PageResult<Project>>('/v1/admin/projects', { params });
export const getProjectApi = (id: string) =>
  requestClient.get<ProjectDetail>(`/v1/admin/projects/${id}`);
export const getAssigneesApi = () =>
  requestClient.get<{ id: string; name: string }[]>(
    '/v1/admin/project-assignees',
  );
export const assignProjectApi = (
  id: string,
  input: Change & { assigneeAdminId: string; reason: string },
) => requestClient.put(`/v1/admin/projects/${id}/assignee`, input);
/** 领取待分配项目；已被他人领取时返回 409 PROJECT_ALREADY_ASSIGNED（details.assigneeName） */
export const claimProjectApi = (id: string, input: { requestKey: string }) =>
  requestClient.post<{
    assigneeAdminId: string;
    projectId: string;
    revision: number;
  }>(`/v1/admin/projects/${id}/claim`, input);
export const followUpApi = (id: string, input: FollowUp) =>
  requestClient.post(`/v1/admin/projects/${id}/follow-ups`, input);
export const linkSchemeApi = (
  id: string,
  input: Change & { schemeCode: string; confirmationNote: string },
) => requestClient.put(`/v1/admin/projects/${id}/scheme`, input);
export const quotationApi = (id: string, revision?: number) =>
  requestClient.get<{
    projectId: string;
    projectRevision: number;
    quotation: null | Quotation;
  }>(`/v1/admin/projects/${id}/quotation`, { params: { revision } });
export const saveQuotationApi = (id: string, input: QuotationInput) =>
  requestClient.put<{
    projectId: string;
    projectRevision: number;
    quotation: Quotation;
    status: ProjectStatus;
  }>(`/v1/admin/projects/${id}/quotation`, input);
export const quotationRevisionsApi = (id: string) =>
  requestClient.get<QuotationRevisionSummary[]>(
    `/v1/admin/projects/${id}/quotation/revisions`,
  );
/** 更新客户可见结果（提交后客户可见）；空字符串表示撤下 */
export const updatePublicResultApi = (
  id: string,
  input: Change & { publicResult: string },
) =>
  requestClient.put<{
    projectId: string;
    publicResult: null | string;
    revision: number;
  }>(`/v1/admin/projects/${id}/public-result`, input);
export const quotationDownloadApi = (id: string, revision: number) =>
  requestClient.get<Blob>(`/v1/admin/projects/${id}/quotation/download`, {
    params: { revision },
    responseType: 'blob',
    responseReturn: 'body',
  });
/** 项目冻结的图片资料：缩略图用于列表，预览图用于放大查看，原图走下载接口 */
export interface ProjectAssetImage {
  versionId: string;
  thumbnailUrl: string;
  previewUrl: string;
}
export const assetImagesApi = (id: string) =>
  requestClient.get<ProjectAssetImage[]>(
    `/v1/admin/projects/${id}/asset-images`,
  );
export const assetDownloadApi = (id: string, version: string) =>
  requestClient.get<{ downloadUrl: string; filename: string }>(
    `/v1/admin/projects/${id}/assets/${version}/download`,
  );
