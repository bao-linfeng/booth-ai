import type pg from 'pg';
import { searchFilter } from './filters.js';
import type { SearchQuery } from './types.js';

export async function getStatistics(pool: pg.Pool, query: Pick<SearchQuery, 'from' | 'to' | 'granularity'>) {
  const values: unknown[] = [];
  const where = searchFilter(query as SearchQuery, values);
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
