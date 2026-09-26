import { getSchemeListApi } from '#/api/core/schemes';

export const createFormOptions = (
  styleOptions: { label: string; value: string }[] = [],
) => ({
  schema: [
    {
      component: 'Input' as const,
      fieldName: 'code',
      label: '方案编号',
      componentProps: { placeholder: '请输入方案编号' },
    },
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '方案名称',
      componentProps: { placeholder: '请输入方案名称' },
    },
    {
      component: 'Select' as const,
      fieldName: 'style',
      label: '风格',
      componentProps: {
        placeholder: '请选择风格',
        options: styleOptions.length > 0 ? styleOptions : [],
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'publishStatus',
      label: '发布状态',
      componentProps: {
        placeholder: '请选择',
        options: [
          { label: '草稿', value: 'draft' },
          { label: '已发布', value: 'published' },
          { label: '未发布', value: 'unpublished' },
        ],
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'verificationStatus',
      label: '核验状态',
      componentProps: {
        placeholder: '请选择',
        options: [
          { label: '未核验', value: 'unverified' },
          { label: '核验通过', value: 'verified' },
          { label: '核验失败', value: 'failed' },
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
    { field: 'code', title: '方案编号', width: 140 },
    { field: 'name', title: '方案名称', minWidth: 180 },
    {
      field: 'dimensions',
      title: '尺寸(长×宽×高 cm)',
      width: 180,
      slots: { default: 'dimensions' },
    },
    { field: 'areaSqm', title: '面积(m²)', width: 100 },
    { field: 'productLine', title: '产品体系', width: 120 },
    { field: 'style', title: '风格', width: 100 },
    {
      field: 'publishStatus',
      title: '发布状态',
      width: 100,
      slots: { default: 'publishStatus' },
    },
    {
      field: 'verificationStatus',
      title: '核验状态',
      width: 100,
      slots: { default: 'verificationStatus' },
    },
    { field: 'createdAt', title: '创建时间', minWidth: 180 },
    {
      field: 'action',
      title: '操作',
      width: 180,
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
        const res = await getSchemeListApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
        return { items: res.data, total: res.total };
      },
    },
  },
});
