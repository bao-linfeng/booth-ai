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
  industryId?: string;
  styleId?: string;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateTemplateInput {
  purpose: TemplatePurpose;
  industryId?: null | string;
  styleId?: null | string;
  body: string;
}

export interface UpdateTemplateInput {
  body?: string;
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

export interface PromptDefinition {
  purpose: TemplatePurpose;
  label: string;
  defaultBody: string;
  defaultVersion: number;
  fixedInstructions: string;
  scope: string;
  inputs: string[];
  variables: {
    name: string;
    label: string;
    source: string;
    example: string;
    fallback: string;
  }[];
}

export interface PromptPreviewInput {
  purpose: TemplatePurpose;
  body: string;
  sample: {
    text?: string;
    industryId?: string;
    styleId?: string;
    brandColors?: string[];
    brandKeywords?: string;
  };
}

export interface PromptPreview {
  variables: string[];
  issues: {
    code: string;
    message: string;
    variable?: string;
    offset?: number;
  }[];
  messages: { role: string; content: string }[];
  directionPrompts: null | Record<'back' | 'front' | 'left' | 'right', string>;
  attachments: string[];
  dictionaryVersion?: string;
}

export function getPromptDefinitionsApi() {
  return requestClient.get<PromptDefinition[]>(
    '/v1/admin/prompt-templates/definitions',
  );
}

export function previewPromptApi(input: PromptPreviewInput) {
  return requestClient.post<PromptPreview>(
    '/v1/admin/prompt-templates/preview',
    input,
  );
}
