import type pg from 'pg';
import { searchFilter } from './filters.js';
import type { SearchQuery } from './types.js';

export async function listUserSearches(
  pool: pg.Pool,
  userId: string,
  query: { page: number; pageSize: number },
): Promise<{
  data: Array<{
    id: string;
    status: string;
    mode: string;
    inputText: string;
    finalRequirement: unknown;
    directCount: number;
    referenceCount: number;
    randomCount: number;
    resultCount: number;
    resultSnapshot: unknown;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const [count, rows] = await Promise.all([
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM selection_searches
       WHERE user_id = $1 AND status = 'matched'`,
      [userId],
    ),
    pool.query<{
      id: string;
      status: string;
      mode: string;
      inputText: string;
      finalRequirement: unknown;
      directCount: number;
      referenceCount: number;
      randomCount: number;
      resultCount: number;
      resultSnapshot: unknown;
      createdAt: string;
    }>(
      `SELECT id, status, mode, input_text AS "inputText", final_requirement AS "finalRequirement",
        direct_count AS "directCount", reference_count AS "referenceCount",
        random_count AS "randomCount", result_count AS "resultCount",
        result_snapshot AS "resultSnapshot", created_at AS "createdAt"
       FROM selection_searches
       WHERE user_id = $1 AND status = 'matched'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, query.pageSize, (query.page - 1) * query.pageSize],
    ),
  ]);

  return {
    data: rows.rows,
    total: count.rows[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listSearchVisitors(pool: pg.Pool) {
  const result = await pool.query<{ visitorId: string; searchCount: number }>(`
    SELECT visitor_id AS "visitorId",count(*)::int AS "searchCount"
    FROM selection_searches
    GROUP BY visitor_id
    ORDER BY count(*) DESC,visitor_id`);
  return result.rows;
}

export async function listSearches(pool: pg.Pool, query: SearchQuery) {
  const values: unknown[] = [];
  const where = searchFilter(query, values);
  const count = await pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM selection_searches s ${where}`, values);
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const rows = await pool.query(`SELECT s.id,s.attempt_id AS "attemptId",s.parse_id AS "parseId",s.visitor_id AS "visitorId",
    (s.user_id IS NOT NULL) AS "loggedIn",COALESCE(NULLIF(u.nickname,''),u.username) AS username,s.mode,s.status,s.input_text AS "inputText",s.direct_count AS "directCount",
    s.reference_count AS "referenceCount",s.random_count AS "randomCount",s.result_count AS "resultCount",
    ARRAY(SELECT item->>'code' FROM jsonb_array_elements(s.result_snapshot) AS item) AS "schemeCodes",
    s.degraded_parse AS "degradedParse",s.duration_ms AS "durationMs",s.created_at AS "createdAt"
    FROM selection_searches s LEFT JOIN users u ON u.id=s.user_id ${where} ORDER BY s.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  return { data: rows.rows, total: Number(count.rows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
}

export async function getSearch(pool: pg.Pool, id: string) {
  const result = await pool.query(`SELECT s.id,s.attempt_id AS "attemptId",s.parse_id AS "parseId",s.visitor_id AS "visitorId",
    (s.user_id IS NOT NULL) AS "loggedIn",s.mode,s.status,s.input_text AS "inputText",s.final_requirement AS "finalRequirement",
    s.direct_count AS "directCount",s.reference_count AS "referenceCount",s.random_count AS "randomCount",s.result_count AS "resultCount",
     s.zero_match_reasons AS "zeroMatchReasons",s.match_diagnostics AS "matchDiagnostics",s.demand_terms AS "demandTerms",s.result_snapshot AS "resultSnapshot",
    s.rules_version AS "rulesVersion",s.dictionary_version AS "dictionaryVersion",s.degraded_parse AS "degradedParse",
    s.duration_ms AS "durationMs",s.created_at AS "createdAt",p.parser,p.degraded AS "parseDegraded",p.field_sources AS "fieldSources",
    p.overrides,p.clarifications,p.unhandled_text AS "unhandledText",p.warnings,p.created_at AS "parsedAt",p.prompt_snapshot AS "promptSnapshot"
    FROM selection_searches s LEFT JOIN selection_parses p ON p.id=s.parse_id WHERE s.id=$1`, [id]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error('Search not found'), { statusCode: 404 });
  return row;
}
