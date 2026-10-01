import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { getSession } from '../../infra/session.js';
import type { MatchDiagnostics, MatchItem, Requirement } from '../client/selection/domain.js';

const visitorPattern = /^[a-zA-Z0-9_-]{16,128}$/;

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
}

export interface SearchRecordInput {
  attemptId: string;
  parseId: string | null;
  identity: SelectionIdentity;
  mode: 'random' | 'filtered';
  inputText: string;
  result: {
    status: 'matched' | 'no_match' | 'needs_clarification';
    requirement: Requirement;
    counts: { direct: number; reference: number; random: number; total: number };
    reasons: string[];
    diagnostics: MatchDiagnostics;
    items: MatchItem[];
    rulesVersion: string;
    dictionaryVersion: string;
  };
  degradedParse: boolean;
  durationMs: number;
}

export function getVisitorId(request: FastifyRequest): string {
  const header = request.headers['x-visitor-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && visitorPattern.test(value) ? value : `v_${randomUUID().replaceAll('-', '')}`;
}

export function getProvidedVisitorId(request: FastifyRequest): string | null {
  const header = request.headers['x-visitor-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && visitorPattern.test(value) ? value : null;
}

export async function getOptionalClientUserId(pool: pg.Pool, redis: Redis, request: FastifyRequest): Promise<string | null> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
  if (!token) return null;
  const session = await getSession(redis, token, 'client');
  if (!session) return null;
  const user = (await pool.query<{ id: string }>('SELECT id FROM users WHERE id=$1 AND enabled=true', [session.localId])).rows[0];
  return user?.id ?? null;
}

export async function ensureAttempt(pool: pg.Pool, attemptId: string | undefined, identity: SelectionIdentity): Promise<string> {
  if (attemptId) {
    const existing = (await pool.query<{ id: string }>('SELECT id FROM selection_attempts WHERE id=$1 AND visitor_id=$2', [attemptId, identity.visitorId])).rows[0];
    if (existing) {
      await pool.query('UPDATE selection_attempts SET user_id=COALESCE($2,user_id),last_seen_at=now() WHERE id=$1', [existing.id, identity.userId]);
      return existing.id;
    }
  }
  const created = await pool.query<{ id: string }>(
    'INSERT INTO selection_attempts(id,visitor_id,user_id) VALUES($1,$2,$3) RETURNING id',
    [attemptId ?? randomUUID(), identity.visitorId, identity.userId],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error('Selection attempt was not created');
  return id;
}

export async function recordParse(pool: pg.Pool, input: ParseRecordInput): Promise<string> {
  const result = await pool.query<{ id: string }>(`
    INSERT INTO selection_parses(
      attempt_id,visitor_id,user_id,input_text,form_requirement,final_requirement,parser,degraded,
      field_sources,overrides,clarifications,unhandled_text,warnings,rules_version,dictionary_version,duration_ms
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING id`, [
      input.attemptId, input.identity.visitorId, input.identity.userId, input.inputText,
      JSON.stringify(input.formRequirement), JSON.stringify(input.result.requirement), input.result.parser, input.result.degraded,
      JSON.stringify(input.result.fieldSources), JSON.stringify(input.result.overrides), JSON.stringify(input.result.clarifications),
      input.result.unhandledText, JSON.stringify(input.result.warnings), input.result.rulesVersion,
      input.result.dictionaryVersion, Math.max(0, Math.round(input.durationMs)),
    ]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Selection parse was not created');
  return id;
}

function snapshotItems(items: MatchItem[]) {
  return items.map(item => ({
    code: item.code,
    matchType: item.matchType,
    images: item.images.map(image => ({ assetId: image.assetId, order: image.order, width: image.width, height: image.height })),
    specifications: item.specifications,
    reasons: item.reasons,
    differences: item.differences,
    pendingConfirmations: item.pendingConfirmations,
    preferenceMisses: item.preferenceMisses,
  }));
}

export function extractDemandTerms(inputText: string, requirement: Requirement): string[] {
  const terms = [...requirement.keywords, ...inputText.toLowerCase().match(/[\p{Script=Han}]{2,12}|[a-z0-9_-]{3,}/giu) ?? []];
  return [...new Set(terms.map(term => term.trim()).filter(term => term.length >= 2))].slice(0, 50);
}

export async function recordSearch(pool: pg.Pool, input: SearchRecordInput): Promise<string> {
  const result = await pool.query<{ id: string }>(`
    INSERT INTO selection_searches(
      attempt_id,parse_id,visitor_id,user_id,mode,status,input_text,final_requirement,
       direct_count,reference_count,random_count,result_count,zero_match_reasons,demand_terms,
       result_snapshot,rules_version,dictionary_version,degraded_parse,duration_ms,match_diagnostics
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    RETURNING id`, [
      input.attemptId, input.parseId, input.identity.visitorId, input.identity.userId, input.mode,
       input.result.status, input.inputText, input.result.requirement, input.result.counts.direct,
       input.result.counts.reference, input.result.counts.random, input.result.counts.total,
       input.result.status === 'no_match' ? input.result.reasons : [], extractDemandTerms(input.inputText, input.result.requirement),
       JSON.stringify(snapshotItems(input.result.items)), input.result.rulesVersion, input.result.dictionaryVersion,
       input.degradedParse, Math.max(0, Math.round(input.durationMs)), JSON.stringify(input.result.diagnostics),
    ]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Selection search was not created');
  return id;
}

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

export async function linkVisitorToUser(pool: pg.Pool, visitorId: string, userId: string): Promise<void> {
  if (!visitorPattern.test(visitorId)) return;
  await pool.query('UPDATE selection_attempts SET user_id=COALESCE(user_id,$2) WHERE visitor_id=$1', [visitorId, userId]);
  await pool.query('UPDATE selection_parses SET user_id=COALESCE(user_id,$2) WHERE visitor_id=$1', [visitorId, userId]);
  await pool.query('UPDATE selection_searches SET user_id=COALESCE(user_id,$2) WHERE visitor_id=$1', [visitorId, userId]);
}

interface SearchQuery {
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

function dateFilter(query: SearchQuery, values: unknown[]): string {
  const filters: string[] = [];
  if (query.from) { values.push(query.from); filters.push(`s.created_at >= $${values.length}::timestamptz`); }
  if (query.to) { values.push(query.to); filters.push(`s.created_at < ($${values.length}::date + interval '1 day')`); }
  if (query.status) { values.push(query.status); filters.push(`s.status = $${values.length}`); }
  if (query.mode) { values.push(query.mode); filters.push(`s.mode = $${values.length}`); }
  if (query.visitorId) { values.push(query.visitorId); filters.push(`s.visitor_id = $${values.length}`); }
  if (query.userId) { values.push(query.userId); filters.push(`s.user_id = $${values.length}`); }
  if (query.schemeCode) {
    values.push(query.schemeCode);
    filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(s.result_snapshot) item WHERE item->>'code' = $${values.length})`);
  }
  return filters.length ? `WHERE ${filters.join(' AND ')}` : '';
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
  const where = dateFilter(query, values);
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
    p.overrides,p.clarifications,p.unhandled_text AS "unhandledText",p.warnings,p.created_at AS "parsedAt"
    FROM selection_searches s LEFT JOIN selection_parses p ON p.id=s.parse_id WHERE s.id=$1`, [id]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error('Search not found'), { statusCode: 404 });
  return row;
}

export async function getStatistics(pool: pg.Pool, query: Pick<SearchQuery, 'from' | 'to' | 'granularity'>) {
  const values: unknown[] = [];
  const where = dateFilter(query as SearchQuery, values);
  const granularity = query.granularity === 'hour' ? 'hour' : 'day';
  const trendFormat = granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
  const overview = (await pool.query(`WITH filtered_searches AS (SELECT s.* FROM selection_searches s ${where})
    SELECT count(*)::int AS searches,count(DISTINCT visitor_id)::int AS "uniqueVisitors",
    count(*) FILTER (WHERE status='matched')::int AS "matchedSearches",count(*) FILTER (WHERE status='no_match')::int AS "noMatchSearches",
    coalesce(sum(direct_count),0)::int AS "directMatches",coalesce(sum(reference_count),0)::int AS "referenceMatches",coalesce(sum(random_count),0)::int AS "randomMatches",
    count(*) FILTER (WHERE user_id IS NOT NULL)::int AS "loggedInSearches",
    coalesce(round(avg(duration_ms)),0)::int AS "avgDurationMs",coalesce(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric),0)::int AS "p95DurationMs",
    coalesce(round(avg(CASE WHEN degraded_parse THEN 1.0 ELSE 0.0 END) * 100, 2),0)::float8 AS "degradedParseRate",
    (SELECT count(DISTINCT item->>'code')::int FROM filtered_searches fs
      CROSS JOIN LATERAL jsonb_array_elements(fs.result_snapshot) item) AS "schemeCount"
    FROM filtered_searches s`, values)).rows[0];
  const trend = (await pool.query(`SELECT to_char(date_trunc('${granularity}',s.created_at),'${trendFormat}') AS date,count(*)::int AS searches,
    count(*) FILTER (WHERE status='matched')::int AS matched,count(*) FILTER (WHERE status='no_match')::int AS "noMatch",
    count(*) FILTER (WHERE user_id IS NOT NULL)::int AS "loggedIn",
    sum(direct_count)::int AS direct,sum(reference_count)::int AS reference,sum(random_count)::int AS random
    FROM selection_searches s ${where} GROUP BY 1 ORDER BY 1`, values)).rows;
  const popularTerms = (await pool.query(`WITH daily_terms AS (
      SELECT to_char(date_trunc('day',s.created_at),'YYYY-MM-DD') AS date,term,count(*)::int AS count
      FROM selection_searches s CROSS JOIN LATERAL unnest(s.demand_terms) term
      ${where ? `${where} AND` : 'WHERE'} s.mode='filtered'
      GROUP BY 1,2
    ), ranked_terms AS (
      SELECT date,term,count,row_number() OVER (PARTITION BY date ORDER BY count DESC,term) AS rank
      FROM daily_terms
    )
    SELECT date,term,count FROM ranked_terms WHERE rank <= 5 ORDER BY date,rank`, values)).rows;
  const conversion = (await pool.query(`SELECT count(DISTINCT visitor_id)::int AS "anonymousVisitors",
    count(DISTINCT visitor_id) FILTER (WHERE user_id IS NOT NULL)::int AS "convertedVisitors"
    FROM selection_searches s ${where}`, values)).rows[0];
  const anonymousVisitors = Number(conversion?.anonymousVisitors ?? 0);
  const convertedVisitors = Number(conversion?.convertedVisitors ?? 0);
  return { overview: { ...overview, conversionRate: anonymousVisitors ? Number((convertedVisitors / anonymousVisitors * 100).toFixed(2)) : 0 }, trend, popularTerms,
    conversion: { anonymousVisitors, convertedVisitors, rate: anonymousVisitors ? Number((convertedVisitors / anonymousVisitors * 100).toFixed(2)) : 0 } };
}
