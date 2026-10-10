import type pg from 'pg';
import type { ProjectStatus } from '../projects/domain.js';

export const analyticsRangeDays = [7, 30, 90] as const;
export type AnalyticsRangeDays = (typeof analyticsRangeDays)[number];

export type AnalyticsMetricKey = 'users' | 'searches' | 'generations' | 'projects';
export type FunnelStageKey = 'visitors' | 'matchedVisitors' | 'generationUsers' | 'inquiryCustomers' | 'wonCustomers';
export type GenerationStatusKey = 'succeeded' | 'partially_succeeded' | 'failed' | 'processing';

interface Distribution<K extends string> {
  key: K;
  value: number;
}

const timeZone = 'Asia/Shanghai';
const projectStatuses: ProjectStatus[] = ['pending', 'following', 'quoted', 'won', 'lost', 'closed'];
const generationStatuses: GenerationStatusKey[] = ['succeeded', 'partially_succeeded', 'failed', 'processing'];
const generationJobs = `(SELECT user_id,status::text AS status,created_at FROM theme_jobs
  UNION ALL SELECT user_id,status::text AS status,created_at FROM artwork_jobs)`;

interface Bounds {
  startAt: Date;
  monthStartAt: Date;
  dates: string[];
  months: string[];
}
interface Totals {
  value: number;
  total: number;
}
interface DailyRow {
  date: string;
  count: number;
}

// 按上海时区自然日/自然月切分，窗口包含今天；所有分布与漏斗都只统计窗口内新增的记录。
async function loadBounds(pool: pg.Pool, days: number): Promise<Bounds> {
  return (
    await pool.query<Bounds>(
      `WITH local AS (
      SELECT date_trunc('day',now() AT TIME ZONE '${timeZone}') AS today,date_trunc('month',now() AT TIME ZONE '${timeZone}') AS month
    ), range AS (SELECT today - make_interval(days => $1::int - 1) AS start_day,month - interval '11 months' AS start_month,today,month FROM local)
    SELECT start_day AT TIME ZONE '${timeZone}' AS "startAt",start_month AT TIME ZONE '${timeZone}' AS "monthStartAt",
      array(SELECT to_char(d,'YYYY-MM-DD') FROM generate_series(start_day,today,interval '1 day') d) AS dates,
      array(SELECT to_char(m,'YYYY-MM') FROM generate_series(start_month,month,interval '1 month') m) AS months
    FROM range`,
      [days],
    )
  ).rows[0]!;
}

function alignDaily(dates: string[], rows: DailyRow[]): number[] {
  const counts = new Map(rows.map(row => [row.date, row.count]));
  return dates.map(date => counts.get(date) ?? 0);
}

function dailyCounts(pool: pg.Pool, source: string, startAt: Date) {
  return pool
    .query<DailyRow>(
      `SELECT to_char(created_at AT TIME ZONE '${timeZone}','YYYY-MM-DD') AS date,count(*)::int AS count
    FROM ${source} source WHERE created_at >= $1 GROUP BY 1`,
      [startAt],
    )
    .then(result => result.rows);
}

function totals(pool: pg.Pool, source: string, startAt: Date) {
  return pool
    .query<Totals>(
      `SELECT count(*) FILTER (WHERE created_at >= $1)::int AS value,count(*)::int AS total
    FROM ${source} source`,
      [startAt],
    )
    .then(result => result.rows[0]!);
}

function orderedDistribution<K extends string>(keys: K[], rows: { key: string; value: number }[]): Distribution<K>[] {
  const counts = new Map(rows.map(row => [row.key, row.value]));
  return keys.map(key => ({ key, value: counts.get(key) ?? 0 }));
}

async function usersSection(pool: pg.Pool, bounds: Bounds) {
  const [overview, daily] = await Promise.all([totals(pool, 'users', bounds.startAt), dailyCounts(pool, 'users', bounds.startAt)]);
  return { overview, daily: alignDaily(bounds.dates, daily) };
}

async function searchesSection(pool: pg.Pool, bounds: Bounds) {
  const [overview, daily, funnel] = await Promise.all([
    totals(pool, 'selection_searches', bounds.startAt),
    dailyCounts(pool, 'selection_searches', bounds.startAt),
    pool
      .query<{ visitors: number; matchedVisitors: number }>(
        `SELECT count(DISTINCT visitor_id)::int AS visitors,
      count(DISTINCT visitor_id) FILTER (WHERE status='matched')::int AS "matchedVisitors"
      FROM selection_searches WHERE created_at >= $1`,
        [bounds.startAt],
      )
      .then(result => result.rows[0]!),
  ]);
  return { overview, daily: alignDaily(bounds.dates, daily), funnel };
}

async function generationsSection(pool: pg.Pool, bounds: Bounds) {
  const [overview, daily, users, statuses] = await Promise.all([
    totals(pool, generationJobs, bounds.startAt),
    dailyCounts(pool, generationJobs, bounds.startAt),
    pool
      .query<{ users: number }>(`SELECT count(DISTINCT user_id)::int AS users FROM ${generationJobs} jobs WHERE created_at >= $1`, [
        bounds.startAt,
      ])
      .then(result => result.rows[0]!.users),
    pool
      .query<{ key: string; value: number }>(
        `SELECT CASE WHEN status IN ('pending','queued','running','settling') THEN 'processing'
      ELSE status END AS key,count(*)::int AS value FROM ${generationJobs} jobs WHERE created_at >= $1 GROUP BY 1`,
        [bounds.startAt],
      )
      .then(result => result.rows),
  ]);
  return { overview, daily: alignDaily(bounds.dates, daily), users, statuses: orderedDistribution(generationStatuses, statuses) };
}

async function projectsSection(pool: pg.Pool, bounds: Bounds) {
  const [overview, daily, customers, statuses, monthly] = await Promise.all([
    totals(pool, 'projects', bounds.startAt),
    dailyCounts(pool, 'projects', bounds.startAt),
    pool
      .query<{ inquiryCustomers: number; wonCustomers: number }>(
        `SELECT count(DISTINCT customer_user_id)::int AS "inquiryCustomers",
      count(DISTINCT customer_user_id) FILTER (WHERE status='won')::int AS "wonCustomers"
      FROM projects WHERE source_type='quote_request' AND created_at >= $1`,
        [bounds.startAt],
      )
      .then(result => result.rows[0]!),
    pool
      .query<{ key: string; value: number }>(
        `SELECT status AS key,count(*)::int AS value FROM projects
      WHERE created_at >= $1 GROUP BY 1`,
        [bounds.startAt],
      )
      .then(result => result.rows),
    pool
      .query<{ month: string; created: number; won: number }>(
        `SELECT to_char(created_at AT TIME ZONE '${timeZone}','YYYY-MM') AS month,
      count(*)::int AS created,count(*) FILTER (WHERE status='won')::int AS won
      FROM projects WHERE created_at >= $1 GROUP BY 1`,
        [bounds.monthStartAt],
      )
      .then(result => result.rows),
  ]);
  const byMonth = new Map(monthly.map(row => [row.month, row]));
  return {
    overview,
    daily: alignDaily(bounds.dates, daily),
    customers,
    statuses: orderedDistribution(projectStatuses, statuses),
    monthly: {
      created: bounds.months.map(month => byMonth.get(month)?.created ?? 0),
      won: bounds.months.map(month => byMonth.get(month)?.won ?? 0),
    },
  };
}

/**
 * 分析页统计：每个分区只在拥有对应模块查看权限时查询，未授权分区不出现在数组中或返回 null。
 * 漏斗前两级按智选访客（visitor_id）去重，后续按登录用户去重，二者口径不同，仅用于观察各环节量级。
 */
export async function getDashboardAnalytics(pool: pg.Pool, permissions: string[], days: AnalyticsRangeDays) {
  const granted = new Set(permissions);
  const bounds = await loadBounds(pool, days);
  const [users, searches, generations, projects] = await Promise.all([
    granted.has('users.read') ? usersSection(pool, bounds) : null,
    granted.has('search-analytics.read') ? searchesSection(pool, bounds) : null,
    granted.has('generation.read') ? generationsSection(pool, bounds) : null,
    granted.has('projects.read') ? projectsSection(pool, bounds) : null,
  ]);
  const sections = { users, searches, generations, projects };
  const metrics = (Object.keys(sections) as AnalyticsMetricKey[]).flatMap(key => {
    const section = sections[key];
    return section ? [{ key, ...section.overview, daily: section.daily }] : [];
  });
  const funnel: Distribution<FunnelStageKey>[] = [
    ...(searches
      ? [
          { key: 'visitors' as const, value: searches.funnel.visitors },
          { key: 'matchedVisitors' as const, value: searches.funnel.matchedVisitors },
        ]
      : []),
    ...(generations ? [{ key: 'generationUsers' as const, value: generations.users }] : []),
    ...(projects
      ? [
          { key: 'inquiryCustomers' as const, value: projects.customers.inquiryCustomers },
          { key: 'wonCustomers' as const, value: projects.customers.wonCustomers },
        ]
      : []),
  ];
  return {
    generatedAt: new Date().toISOString(),
    timeZone,
    days,
    dates: bounds.dates,
    months: bounds.months,
    overview: metrics.map(({ key, value, total }) => ({ key, value, total })),
    trend: metrics.map(({ key, daily }) => ({ key, data: daily })),
    monthlyProjects: projects?.monthly ?? null,
    funnel,
    projectStatuses: projects?.statuses ?? null,
    generationStatuses: generations?.statuses ?? null,
  };
}
