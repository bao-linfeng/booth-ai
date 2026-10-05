import { requestClient } from '#/api/request';

export interface DictionaryRecord {
  id: string;
  code: string;
  name: string;
  type: string;
  description: null | string;
  enabled: boolean;
  sortOrder: number;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryDetailRecord extends DictionaryRecord {
  items: DictionaryItemRecord[];
}

export interface DictionaryItemRecord {
  id: string;
  dictionaryId: string;
  itemValue: string;
  itemLabel: string;
  labels: Record<string, string>;
  aliases: DictionaryAlias[];
  lengthMm: null | number;
  widthMm: null | number;
  heightMm: null | number;
  description: null | string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryAlias { locale: string; text: string; }

export interface DictionaryListParams {
  page?: number;
  pageSize?: number;
  code?: string;
  name?: string;
  type?: string;
  enabled?: boolean;
}

export interface DictionaryListResult {
  data: DictionaryRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateDictionaryInput {
  code: string;
  name: string;
  type: string;
  description?: null | string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface UpdateDictionaryInput {
  name?: string;
  type?: string;
  description?: null | string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface CreateDictionaryItemInput {
  itemValue: string;
  itemLabel: string;
  description?: null | string;
  enabled?: boolean;
  sortOrder?: number;
  labels?: Record<string, string>;
  aliases?: DictionaryAlias[];
}

export interface UpdateDictionaryItemInput {
  itemLabel?: string;
  description?: null | string;
  enabled?: boolean;
  sortOrder?: number;
  labels?: Record<string, string>;
  aliases?: DictionaryAlias[];
}

export function getDictionaryListApi(params: DictionaryListParams) {
  return requestClient.get<DictionaryListResult>('/v1/admin/dictionaries', {
    params,
  });
}

export function getDictionaryDetailApi(id: string) {
  return requestClient.get<DictionaryDetailRecord>(
    `/v1/admin/dictionaries/${id}`,
  );
}

export function createDictionaryApi(data: CreateDictionaryInput) {
  return requestClient.post<DictionaryRecord>('/v1/admin/dictionaries', data);
}

export function updateDictionaryApi(id: string, data: UpdateDictionaryInput) {
  return requestClient.put<DictionaryRecord>(
    `/v1/admin/dictionaries/${id}`,
    data,
  );
}

export function deleteDictionaryApi(id: string) {
  return requestClient.delete<void>(`/v1/admin/dictionaries/${id}`);
}

export function getDictionaryItemsApi(id: string) {
  return requestClient.get<DictionaryItemRecord[]>(
    `/v1/admin/dictionaries/${id}/items`,
  );
}

export function createDictionaryItemApi(
  id: string,
  data: CreateDictionaryItemInput,
) {
  return requestClient.post<DictionaryItemRecord>(
    `/v1/admin/dictionaries/${id}/items`,
    data,
  );
}

export function updateDictionaryItemApi(
  id: string,
  itemId: string,
  data: UpdateDictionaryItemInput,
) {
  return requestClient.put<DictionaryItemRecord>(
    `/v1/admin/dictionaries/${id}/items/${itemId}`,
    data,
  );
}

export function deleteDictionaryItemApi(id: string, itemId: string) {
  return requestClient.delete<void>(
    `/v1/admin/dictionaries/${id}/items/${itemId}`,
  );
}
