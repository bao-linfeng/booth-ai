import type { SearchQuery } from './types.js';

export function searchFilter(query: SearchQuery, values: unknown[]): string {
  const filters: string[] = [];
  if (query.from) {
    values.push(query.from);
    filters.push(`s.created_at >= $${values.length}::timestamptz`);
  }
  if (query.to) {
    values.push(query.to);
    filters.push(`s.created_at < ($${values.length}::date + interval '1 day')`);
  }
  if (query.status) {
    values.push(query.status);
    filters.push(`s.status = $${values.length}`);
  }
  if (query.mode) {
    values.push(query.mode);
    filters.push(`s.mode = $${values.length}`);
  }
  if (query.visitorId) {
    values.push(query.visitorId);
    filters.push(`s.visitor_id = $${values.length}`);
  }
  if (query.userId) {
    values.push(query.userId);
    filters.push(`s.user_id = $${values.length}`);
  }
  if (query.schemeCode) {
    values.push(query.schemeCode);
    // 与 selection_searches_scheme_codes_idx 的表达式一致才能走索引
    filters.push(`jsonb_path_query_array(s.result_snapshot, '$[*].code') @> jsonb_build_array($${values.length}::text)`);
  }
  return filters.length ? `WHERE ${filters.join(' AND ')}` : '';
}
