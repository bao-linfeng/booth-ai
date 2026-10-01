import { requestClient } from '#/api/request';

export interface ApplicabilityQuestion {
  id: string;
  label: string;
  helpText: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListQuestionsQuery {
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateQuestionInput {
  id: string;
  label: string;
  helpText?: string;
  sortOrder?: number;
}

export interface UpdateQuestionInput {
  label?: string;
  helpText?: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export function listQuestionsApi(query: ListQuestionsQuery = {}) {
  return requestClient.get<PageResult<ApplicabilityQuestion>>(
    '/v1/admin/applicability-questions',
    { params: query },
  );
}

export function createQuestionApi(input: CreateQuestionInput) {
  return requestClient.post<ApplicabilityQuestion>(
    '/v1/admin/applicability-questions',
    input,
  );
}

export function updateQuestionApi(id: string, input: UpdateQuestionInput) {
  return requestClient.request<ApplicabilityQuestion>(
    `/v1/admin/applicability-questions/${encodeURIComponent(id)}`,
    { method: 'PATCH', data: input },
  );
}

export function deleteQuestionApi(id: string) {
  return requestClient.delete(
    `/v1/admin/applicability-questions/${encodeURIComponent(id)}`,
  );
}