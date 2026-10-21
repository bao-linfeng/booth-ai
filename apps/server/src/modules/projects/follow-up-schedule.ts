// 下次跟进时间取项目最新一条跟进记录约定的 nextFollowUpAt；列表筛选与工作台共用同一口径。
export const followUpTimeZone = 'Asia/Shanghai';

/** 项目最新一条跟进记录的下次跟进时间（无则为 NULL） */
export function nextFollowUpSql(projectAlias: string): string {
  return `(SELECT (payload->>'nextFollowUpAt')::timestamptz FROM project_events
    WHERE project_id=${projectAlias}.id AND kind='follow-up' ORDER BY created_at DESC,id DESC LIMIT 1)`;
}

/** 当天 0 点（按 followUpTimeZone） */
export const todayStartSql = `(date_trunc('day',now() AT TIME ZONE '${followUpTimeZone}') AT TIME ZONE '${followUpTimeZone}')`;

export const activeStatusesSql = `('pending','following','quoted')`;
