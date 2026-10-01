import { requestClient } from '#/api/request';

export type TemplatePurpose = 'artwork' | 'filter' | 'theme';

export interface PromptTemplate {
  id: string;
  purpose: TemplatePurpose;
  industryId: null | string;
  styleId: null | string;
  body: string;
  variables: string[];
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListTemplatesQuery {
  purpose?: TemplatePurpose;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateTemplateInput {
  purpose: TemplatePurpose;
  industryId?: null | string;
  styleId?: null | string;
  body: string;
  variables?: string[];
}

export interface UpdateTemplateInput {
  body?: string;
  variables?: string[];
  enabled?: boolean;
  expectedRevision: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export function listPromptTemplatesApi(query: ListTemplatesQuery = {}) {
  return requestClient.get<PageResult<PromptTemplate>>(
    '/v1/admin/prompt-templates',
    { params: query },
  );
}

export function createPromptTemplateApi(input: CreateTemplateInput) {
  return requestClient.post<PromptTemplate>(
    '/v1/admin/prompt-templates',
    input,
  );
}

export function getPromptTemplateApi(id: string) {
  return requestClient.get<PromptTemplate>(`/v1/admin/prompt-templates/${id}`);
}

export function updatePromptTemplateApi(
  id: string,
  input: UpdateTemplateInput,
) {
  return requestClient.request<PromptTemplate>(
    `/v1/admin/prompt-templates/${encodeURIComponent(id)}`,
    { method: 'PATCH', data: input },
  );
}
