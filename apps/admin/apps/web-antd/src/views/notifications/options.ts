import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';
import type {
  ProjectNotification,
  ProjectNotificationQuery,
} from '#/api/core/project-notifications';

import {
  listProjectNotificationsApi,
  notificationKindLabels,
} from '#/api/core/project-notifications';

export const createFormOptions = (): VbenFormProps => ({
  schema: [
    {
      component: 'Select' as const,
      fieldName: 'isRead',
      label: '状态',
      componentProps: {
        placeholder: '请选择',
        allowClear: true,
        options: [
          { label: '未读', value: false },
          { label: '已读', value: true },
        ],
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'kind',
      label: '类型',
      componentProps: {
        placeholder: '请选择',
        allowClear: true,
        options: Object.entries(notificationKindLabels).map(
          ([value, label]) => ({ label, value }),
        ),
      },
    },
    {
      component: 'Input' as const,
      fieldName: 'projectNo',
      label: '项目编号',
      componentProps: { placeholder: '请输入项目编号', allowClear: true },
    },
  ],
});

export const createGridOptions = (): VxeGridProps<ProjectNotification> => ({
  showOverflow: 'tooltip' as const,
  height: 'auto',
  toolbarConfig: { custom: true, refresh: true, zoom: true },
  columns: [
    { field: 'kind', title: '类型', width: 130, slots: { default: 'kind' } },
    { field: 'projectNo', title: '项目编号', minWidth: 150 },
    {
      field: 'summary',
      title: '客户 / 展会',
      minWidth: 260,
      slots: { default: 'summary' },
    },
    {
      field: 'delivery',
      title: '渠道投递',
      width: 110,
      slots: { default: 'delivery' },
    },
    { field: 'isRead', title: '状态', width: 90, slots: { default: 'read' } },
    {
      field: 'occurredAt',
      title: '发生时间',
      width: 180,
      slots: { default: 'occurredAt' },
    },
    {
      field: 'action',
      title: '操作',
      width: 100,
      fixed: 'right' as const,
      slots: { default: 'action' },
    },
  ],
  pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
  proxyConfig: {
    enabled: true,
    autoLoad: true,
    ajax: {
      query: async ({ page }, formValues: ProjectNotificationQuery = {}) => {
        const res = await listProjectNotificationsApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          isRead:
            typeof formValues.isRead === 'boolean'
              ? formValues.isRead
              : undefined,
          kind: formValues.kind || undefined,
          projectNo: formValues.projectNo?.trim() || undefined,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
});
