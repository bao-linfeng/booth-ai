import { getUserListApi } from '#/api/core/user-manage';

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
      fieldName: 'mobile',
      label: '手机号',
      componentProps: { placeholder: '请输入手机号' },
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
    { field: 'mobile', title: '手机号', minWidth: 120 },
    { field: 'email', title: '邮箱', minWidth: 160 },
    { field: 'company', title: '公司', minWidth: 160 },
    {
      field: 'enabled',
      title: '状态',
      width: 100,
      slots: { default: 'status' },
    },
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
        const { mobile, ...rest } = formValues ?? {};
        return getUserListApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          phone: mobile,
          ...rest,
        });
      },
    },
  },
});
