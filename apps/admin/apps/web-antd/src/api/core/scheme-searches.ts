import { requestClient } from '#/api/request';

export interface SchemeSearchRecord {
  id: string;
  attemptId: string;
  parseId: null | string;
  visitorId: string;
  loggedIn: boolean;
  username: null | string;
  mode: 'filtered' | 'random';
  status: 'matched' | 'no_match' | 'needs_clarification';
  inputText: string;
  directCount: number;
  referenceCount: number;
  randomCount: number;
  resultCount: number;
  schemeCodes: string[];
  degradedParse: boolean;
  durationMs: number;
  createdAt: string;
}

export interface SchemeSearchListParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  status?: SchemeSearchRecord['status'];
  mode?: SchemeSearchRecord['mode'];
  visitorId?: string;
  userId?: string;
  schemeCode?: string;
}

export interface SchemeSearchVisitorOption {
  visitorId: string;
  searchCount: number;
}

export interface SchemeSearchListResult {
  data: SchemeSearchRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SchemeSearchDetail extends SchemeSearchRecord {
  finalRequirement: Record<string, unknown>;
  zeroMatchReasons: string[];
  matchDiagnostics: null | {
    reviewedPublished: number;
    ready: number;
    exclusions: Record<'unverifiedChecklist' | 'incompleteAssets' | 'invalidData' | 'productSystem' | 'height' | 'applicability' | 'tags' | 'dimensions', number>;
  };
  demandTerms: string[];
  resultSnapshot: Record<string, unknown>[];
  rulesVersion: string;
  dictionaryVersion: string;
  parser?: 'llm' | 'rules' | 'none';
  parseDegraded?: boolean;
  fieldSources?: Record<string, unknown>;
  overrides?: Record<string, unknown>[];
  clarifications?: Record<string, unknown>[];
  unhandledText?: string[];
  warnings?: Record<string, unknown>[];
  parsedAt?: string;
}

export interface SchemeSearchStatistics {
  overview: {
    searches: number;
    uniqueVisitors: number;
    schemeCount: number;
    matchedSearches: number;
    noMatchSearches: number;
    directMatches: number;
    referenceMatches: number;
    randomMatches: number;
    loggedInSearches: number;
    avgDurationMs: number;
    p95DurationMs: number;
    degradedParseRate: number;
    conversionRate: number;
  };
  trend: { date: string; searches: number; matched: number; noMatch: number; loggedIn: number; direct: number; reference: number; random: number }[];
  popularTerms: { date: string; term: string; count: number }[];
  conversion: { anonymousVisitors: number; convertedVisitors: number; rate: number };
}

export async function getSchemeSearchListApi(params?: SchemeSearchListParams) {
  return requestClient.get<SchemeSearchListResult>('/v1/admin/scheme-searches', { params });
}

export async function getSchemeSearchDetailApi(id: string) {
  return requestClient.get<SchemeSearchDetail>(`/v1/admin/scheme-searches/${id}`);
}

export async function getSchemeSearchVisitorsApi() {
  return requestClient.get<SchemeSearchVisitorOption[]>('/v1/admin/scheme-searches/visitors');
}

export async function getSchemeSearchStatisticsApi(params?: Pick<SchemeSearchListParams, 'from' | 'to'> & { granularity?: 'date' | 'hour' }) {
  return requestClient.get<SchemeSearchStatistics>('/v1/admin/scheme-searches/statistics', { params });
}
