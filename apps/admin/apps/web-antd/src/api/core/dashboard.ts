import type { ProjectStatus } from './projects';

import { requestClient } from '#/api/request';

export interface DashboardSummary {
  generatedAt: string;
  timeZone: string;
  projects: null | {
    pending: number;
    todayFollowUps: number;
    overdueFollowUps: number;
    recentInquiries: {
      projectId: string;
      projectNo: string;
      company: null | string;
      contactName: null | string;
      status: ProjectStatus;
      createdAt: string;
    }[];
  };
  schemes: null | { unverified: number };
  generation: null | { failed: number };
  notifications: null | { failed: number };
}

export const getDashboardSummaryApi = () =>
  requestClient.get<DashboardSummary>('/v1/admin/dashboard/summary');

export type AnalyticsRangeDays = 7 | 30 | 90;
export type AnalyticsMetricKey =
  | 'generations'
  | 'projects'
  | 'searches'
  | 'users';
export type AnalyticsFunnelKey =
  | 'generationUsers'
  | 'inquiryCustomers'
  | 'matchedVisitors'
  | 'visitors'
  | 'wonCustomers';
export type AnalyticsGenerationStatus =
  | 'failed'
  | 'partially_succeeded'
  | 'processing'
  | 'succeeded';

interface AnalyticsDistribution<K extends string> {
  key: K;
  value: number;
}

/** 未授权的模块不会出现在数组中，对应的对象字段为 null。 */
export interface DashboardAnalytics {
  generatedAt: string;
  timeZone: string;
  days: AnalyticsRangeDays;
  /** 近 N 天的自然日（YYYY-MM-DD），与 trend[].data 一一对应 */
  dates: string[];
  /** 近 12 个自然月（YYYY-MM），与 monthlyProjects 一一对应 */
  months: string[];
  /** value 为窗口内新增，total 为累计 */
  overview: { key: AnalyticsMetricKey; total: number; value: number }[];
  trend: { data: number[]; key: AnalyticsMetricKey }[];
  monthlyProjects: null | { created: number[]; won: number[] };
  funnel: AnalyticsDistribution<AnalyticsFunnelKey>[];
  projectStatuses: AnalyticsDistribution<ProjectStatus>[] | null;
  generationStatuses: AnalyticsDistribution<AnalyticsGenerationStatus>[] | null;
}

export const getDashboardAnalyticsApi = (days: AnalyticsRangeDays) =>
  requestClient.get<DashboardAnalytics>('/v1/admin/dashboard/analytics', {
    params: { days },
  });
