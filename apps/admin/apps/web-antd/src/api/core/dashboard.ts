import type { ProjectStatus } from './projects';

import { requestClient } from '#/api/request';

export type WorkspaceTaskReason = 'overdue' | 'pending' | 'today';

/** 工作台个人数据：项目与消息仅统计当前登录管理员本人，未授权分组为 null。 */
export interface DashboardWorkspace {
  generatedAt: string;
  timeZone: string;
  projects: {
    /** 本人负责的未结束项目（待跟进 / 跟进中 / 已报价） */
    active: number;
    pending: number;
    todayFollowUps: number;
    overdueFollowUps: number;
    /** 需处理事项总数，tasks 最多返回 10 条 */
    taskTotal: number;
    tasks: {
      projectId: string;
      projectNo: string;
      company: null | string;
      contactName: null | string;
      exhibitionName: null | string;
      status: ProjectStatus;
      reason: WorkspaceTaskReason;
      nextFollowUpAt: null | string;
      createdAt: string;
    }[];
    activities: {
      id: string;
      kind: string;
      projectId: string;
      projectNo: string;
      actorName: null | string;
      byMe: boolean;
      fromStatus: null | ProjectStatus;
      toStatus: null | ProjectStatus;
      schemeCode: null | string;
      quotationRevision: null | number;
      createdAt: string;
    }[];
  } | null;
  notifications: null | { unread: number };
}

export const getDashboardWorkspaceApi = () =>
  requestClient.get<DashboardWorkspace>('/v1/admin/dashboard/workspace');

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
