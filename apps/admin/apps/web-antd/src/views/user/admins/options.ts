import { getAdminListApi } from '#/api/core/user-manage';

export const createFormOptions = () => ({
  schema: [
    {
      component: 'Input' as const,
      fieldName: 'username',
      label: '用户名',
      componentProps: { placeholder: '请输入用户名' },
    },
    {
      component: 'Input' as const,
      fieldName: 'email',
      label: '邮箱',
      componentProps: { placeholder: '请输入邮箱' },
    },
  ],
  showCollapseButton: true,
});

export const createGridOptions = () => ({
  showOverflow: 'tooltip' as const,
  height: 'auto',
  toolbarConfig: { custom: true, refresh: true, zoom: true },
  columns: [
    { field: 'id', title: 'ID', width: 80 },
    { field: 'username', title: '用户名', minWidth: 120 },
    { field: 'nickname', title: '昵称', minWidth: 120 },
    { field: 'email', title: '邮箱', minWidth: 160 },
    { 
      field: 'roles', 
      title: '角色', 
      minWidth: 160,
      formatter: ({ cellValue }: any) => Array.isArray(cellValue) ? cellValue.join(', ') : ''
    },
    { field: 'enabled', title: '状态', width: 100, slots: { default: 'status' } },
    { field: 'createdAt', title: '创建时间', minWidth: 180 },
  ],
  pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
  proxyConfig: {
    enabled: true,
    autoLoad: true,
    response: {
      list: 'data',
      total: 'total',
      result: 'data',
    },
    ajax: {
      query: async ({ page }: any, formValues: any = {}) => {
        return getAdminListApi({ page: page.currentPage, pageSize: page.pageSize, ...formValues });
      },
    },
  },
});
