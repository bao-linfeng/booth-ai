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
  claimed: '客户登录认领',
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
  assigneeAdminId: string;
  assigneeName: string;
  assigneeStatus: AssigneeStatus;
  attribution: Record<string, unknown>;
  status: ProjectStatus;
  revision: number;
  schemeCode: null | string;
  request: ProjectRequest;
  publicResult: null | string;
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
export type AssigneeStatus = 'active' | 'disabled' | 'permission_revoked';
export const assigneeStatusLabels: Record<AssigneeStatus, string> = {
  active: '有效',
  disabled: '已停用',
  permission_revoked: '缺少项目查看或跟进权限',
};
export interface AssignmentConfig {
  defaultAssigneeAdminId: null | string;
  assigneeName: null | string;
  status: 'unconfigured' | AssigneeStatus;
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
  events: PageResult<ProjectEvent>;
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
export interface FollowUp extends Change {
  contactMethod: string;
  contactedAt: string;
  content: string;
  targetStatus?: ProjectStatus;
  nextFollowUpAt?: string;
  outcome?: string;
  reopenReason?: string;
  publicResult?: string;
  quoteEvidence?:
    | {
        type: 'external_manual';
        reference: string;
        sentAt: string;
        channel: string;
      }
    | {
        type: 'platform';
        quotationRevision: number;
        sentAt: string;
        channel: string;
      };
}
export type QuotationInput = Change &
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
  > & { expectedQuotationRevision: number };
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
  }>(`/v1/admin/projects/${id}/quotation`, input);
export const quotationDownloadApi = (id: string, revision: number) =>
  requestClient.get<Blob>(`/v1/admin/projects/${id}/quotation/download`, {
    params: { revision },
    responseType: 'blob',
    responseReturn: 'body',
  });
export const assetDownloadApi = (id: string, version: string) =>
  requestClient.get<{ downloadUrl: string; filename: string }>(
    `/v1/admin/projects/${id}/assets/${version}/download`,
  );
export const projectEventsApi = (id: string, page: number) =>
  requestClient.get<PageResult<ProjectEvent>>(
    `/v1/admin/projects/${id}/events`,
    { params: { page, pageSize: 20 } },
  );
