import type { Catalog, MatchDiagnostics, MatchItem, PublicImage, Requirement } from '../domain.js';

export type RecordedMatchItem = MatchItem<Pick<PublicImage, 'assetId' | 'order' | 'width' | 'height'>>;

export interface SelectionIdentity {
  visitorId: string;
  userId: string | null;
}

export interface ParseRecordInput {
  attemptId: string;
  identity: SelectionIdentity;
  inputText: string;
  formRequirement: Requirement;
  result: {
    requirement: Requirement;
    parser: 'llm' | 'rules' | 'none';
    degraded: boolean;
    fieldSources: unknown;
    overrides: unknown;
    clarifications: unknown;
    unhandledText: string[];
    warnings: unknown;
    rulesVersion: string;
    dictionaryVersion: string;
  };
  durationMs: number;
  promptSnapshot?: { source: string; templateId: string | null; revision: number | null; defaultVersion: number; messages: { role: string; content: string }[] } | null;
}

export interface SearchRecordInput {
  attemptId: string;
  parseId: string | null;
  identity: SelectionIdentity;
  mode: 'random' | 'filtered';
  inputText: string;
  catalog: Catalog;
  result: {
    status: 'matched' | 'no_match' | 'needs_clarification';
    requirement: Requirement;
    counts: { direct: number; reference: number; random: number; total: number };
    reasons: string[];
    diagnostics: MatchDiagnostics;
    items: RecordedMatchItem[];
    rulesVersion: string;
    dictionaryVersion: string;
  };
  degradedParse: boolean;
  durationMs: number;
}

export interface SearchQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  granularity?: 'date' | 'hour';
  status?: string;
  mode?: string;
  visitorId?: string;
  userId?: string;
  schemeCode?: string;
}
