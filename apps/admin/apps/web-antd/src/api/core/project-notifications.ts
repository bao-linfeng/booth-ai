import { requestClient } from '#/api/request';

export type NotificationDelivery = 'delivered' | 'failed' | 'pending';

export interface ProjectNotification {
  id: string;
  eventId: string;
  kind: string;
  projectId: string;
  projectNo: string;
  sourceType: 'manual_request' | 'quote_request';
  company: null | string;
  contactName: null | string;
  exhibitionName: null | string;
  occurredAt: string;
  isRead: boolean;
  readAt: null | string;
  delivery: NotificationDelivery;
}

export interface ProjectNotificationDetail extends ProjectNotification {
  payload: Record<string, unknown>;
  status: string;
  schemeCode: null | string;
  assigneeName: string;
  deliveredAt: null | string;
  failedAt: null | string;
  attempts: number;
  lastErrorCode: null | string;
}

export interface ProjectNotificationQuery {
  page?: number;
  pageSize?: number;
  isRead?: boolean;
  kind?: string;
  projectNo?: string;
}

export interface ProjectNotificationPage {
  items: ProjectNotification[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

export const notificationKindLabels: Record<string, string> = {
  accepted: '新项目受理',
  artworks: '画稿已交付',
};

export const deliveryLabels: Record<NotificationDelivery, string> = {
  pending: '待投递',
  delivered: '已投递',
  failed: '投递失败',
};

export function notificationTitle(item: ProjectNotification) {
  return `${notificationKindLabels[item.kind] ?? item.kind} · ${item.projectNo}`;
}

export function notificationSummary(item: ProjectNotification) {
  return (
    [item.company, item.contactName, item.exhibitionName]
      .filter(Boolean)
      .join(' / ') || '—'
  );
}

export const listProjectNotificationsApi = (
  params: ProjectNotificationQuery = {},
) =>
  requestClient.get<ProjectNotificationPage>(
    '/v1/admin/project-notifications',
    { params },
  );
export const getProjectNotificationApi = (id: string) =>
  requestClient.get<ProjectNotificationDetail>(
    `/v1/admin/project-notifications/${id}`,
  );
export const markProjectNotificationReadApi = (id: string) =>
  requestClient.post<{ id: string; isRead: true }>(
    `/v1/admin/project-notifications/${id}/read`,
  );
export const markAllProjectNotificationsReadApi = () =>
  requestClient.post<{ updated: number }>(
    '/v1/admin/project-notifications/read-all',
  );
