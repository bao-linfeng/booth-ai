import type { ProjectQuery } from '#/api/core/projects';

import { listProjectsApi, statusLabels } from '#/api/core/projects';

export const createFormOptions = () => ({
  schema: [
    {
      component: 'Input' as const,
      fieldName: 'projectNo',
      label: '项目编号',
      componentProps: { placeholder: '请输入项目编号' },
    },
    {
      component: 'Input' as const,
      fieldName: 'schemeCode',
      label: '方案编号',
      componentProps: { placeholder: '请输入方案编号' },
    },
    {
      component: 'Input' as const,
      fieldName: 'customerName',
      label: '客户/联系人',
      componentProps: { placeholder: '请输入客户/联系人' },
    },
    {
      component: 'Input' as const,
      fieldName: 'exhibitionName',
      label: '展会',
      componentProps: { placeholder: '请输入展会' },
    },
    {
      component: 'Input' as const,
      fieldName: 'city',
      label: '城市',
      componentProps: { placeholder: '请输入城市' },
    },
    {
      component: 'Select' as const,
      fieldName: 'status',
      label: '处理状态',
      componentProps: {
        allowClear: true,
        placeholder: '请选择处理状态',
        options: Object.entries(statusLabels).map(([value, label]) => ({
          value,
          label,
        })),
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'sourceType',
      label: '来源',
      componentProps: {
        allowClear: true,
        placeholder: '请选择来源',
        options: [
          { value: 'quote_request', label: '报价申请' },
          { value: 'manual_request', label: '人工需求' },
        ],
      },
    },
  ],
  showCollapseButton: true,
});

export const createGridOptions = () => ({
  showOverflow: 'tooltip' as const,
  height: 'auto',
  toolbarConfig: { custom: true, refresh: true, zoom: true },
  columns: [
    {
      field: 'projectNo',
      title: '项目编号',
      minWidth: 160,
      fixed: 'left' as const,
    },
    {
      field: 'sourceType',
      title: '来源',
      width: 110,
      slots: { default: 'source' },
    },
    { field: 'schemeCode', title: '方案编号', minWidth: 150 },
    { field: 'request.contact.name', title: '联系人', minWidth: 120 },
    { field: 'request.company', title: '企业', minWidth: 160 },
    { field: 'request.exhibition.name', title: '展会', minWidth: 180 },
    { field: 'request.exhibition.city', title: '城市', minWidth: 100 },
    {
      field: 'budget',
      title: '材料预算',
      minWidth: 140,
      slots: { default: 'budget' },
    },
    {
      field: 'assigneeName',
      title: '承接人',
      minWidth: 200,
      slots: { default: 'assignee' },
    },
    {
      field: 'status',
      title: '状态',
      width: 110,
      slots: { default: 'status' },
    },
    {
      field: 'updatedAt',
      title: '更新时间',
      minWidth: 180,
      sortable: true,
      slots: { default: 'updated' },
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
      query: async ({ page }: any, formValues: ProjectQuery = {}) => {
        const res = await listProjectsApi({
          ...formValues,
          page: page.currentPage,
          pageSize: page.pageSize,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
});
