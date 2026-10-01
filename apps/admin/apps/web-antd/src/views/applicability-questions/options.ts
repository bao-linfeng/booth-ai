import type { VxeGridProps } from '#/adapter/vxe-table';

import { listQuestionsApi } from '#/api/core/applicability-questions';

export const createFormOptions = () => ({
  schema: [
    {
      component: 'Select' as const,
      fieldName: 'enabled',
      label: '状态',
      componentProps: {
        placeholder: '请选择',
        allowClear: true,
        options: [
          { label: '启用', value: true },
          { label: '停用', value: false },
        ],
      },
    },
  ],
});

export const createGridOptions = (): VxeGridProps => ({
  showOverflow: 'tooltip' as const,
  height: 'auto',
  toolbarConfig: { custom: true, refresh: true, zoom: true },
  columns: [
    { field: 'id', title: 'ID', width: 180, fixed: 'left' as const },
    { field: 'label', title: '问题文本', minWidth: 200 },
    {
      field: 'helpTextPreview',
      title: '补充说明',
      minWidth: 200,
      slots: { default: 'helpTextPreview' },
    },
    { field: 'sortOrder', title: '排序', width: 80 },
    {
      field: 'enabled',
      title: '状态',
      width: 80,
      slots: { default: 'enabled' },
    },
    { field: 'updatedAt', title: '更新时间', width: 170 },
    {
      field: 'action',
      title: '操作',
      width: 160,
      fixed: 'right' as const,
      slots: { default: 'action' },
    },
  ],
  pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
  proxyConfig: {
    enabled: true,
    autoLoad: true,
    ajax: {
      query: async ({ page }: any, formValues: any = {}) => {
        const res = await listQuestionsApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
});
