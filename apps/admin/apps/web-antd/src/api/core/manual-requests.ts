import { requestClient } from '#/api/request';

export type ManualStatus = 'pending' | 'following_up' | 'completed';

export interface ManualRequest {
  id: string;
  userId: null | string;
  contactName: string;
  contactDetail: string;
  originalText: string;
  requirement: Record<string, unknown>;
  unresolvedQuestions: string[];
  schemeContext: null | {
    code: string;
    differences: { field: string; requested: string; actual: string; reason: string }[];
    pendingConfirmations: string[];
  };
  status: ManualStatus;
  followUpNote: string;
  followedBy: null | string;
  createdAt: string;
  updatedAt: string;
}

export function listManualRequestsApi(params: { page: number; pageSize: number; status?: ManualStatus }) {
  return requestClient.get<{ data: ManualRequest[]; total: number; page: number; pageSize: number }>('/v1/admin/manual-requests', { params });
}

export function getManualRequestApi(id: string) {
  return requestClient.get<ManualRequest>(`/v1/admin/manual-requests/${encodeURIComponent(id)}`);
}

export function followUpManualRequestApi(id: string, input: { status: ManualStatus; followUpNote: string }) {
  return requestClient.request<ManualRequest>(`/v1/admin/manual-requests/${encodeURIComponent(id)}`, { method: 'PATCH', data: input });
}
