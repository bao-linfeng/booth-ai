import { getDictionaryListApi } from '#/api/core/dictionaries';

export const createFormOptions = () => ({
  schema: [
    {
      component: 'Input' as const,
      fieldName: 'code',
      label: '字典编码',
      componentProps: { placeholder: '请输入字典编码' },
    },
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '字典名称',
      componentProps: { placeholder: '请输入字典名称' },
    },
    {
      component: 'Input' as const,
      fieldName: 'type',
      label: '字典类型',
      componentProps: { placeholder: '请输入类型标记（如：尺寸、开口）' },
    },
    {
      component: 'Select' as const,
      fieldName: 'enabled',
      label: '状态',
      componentProps: {
        placeholder: '请选择',
        options: [
          { label: '启用', value: true },
          { label: '禁用', value: false },
        ],
      },
    },
  ],
  showCollapseButton: false,
});

export const createGridOptions = () => ({
  columns: [
    {
      type: 'seq' as const,
      title: '序号',
      width: 60,
      align: 'center' as const,
    },
    { field: 'code', title: '字典编码', minWidth: 120 },
    { field: 'name', title: '字典名称', minWidth: 120 },
    { field: 'type', title: '类型', width: 120 },
    { field: 'description', title: '描述', minWidth: 150 },
    {
      field: 'itemCount',
      title: '字典项数',
      width: 100,
      align: 'center' as const,
    },
    { field: 'sortOrder', title: '排序', width: 80, align: 'center' as const },
    {
      field: 'enabled',
      title: '状态',
      slots: { default: 'enabled' },
      width: 100,
      align: 'center' as const,
    },
    { field: 'createdAt', title: '创建时间', width: 160 },
    {
      title: '操作',
      width: 200,
      slots: { default: 'action' },
      align: 'center' as const,
      fixed: 'right' as const,
    },
  ],
  pagerConfig: {
    enabled: true,
  },
  proxyConfig: {
    enabled: true,
    autoLoad: true,
    ajax: {
      query: async ({ page }: any, formValues = {}) => {
        const { currentPage, pageSize } = page;
        const res = await getDictionaryListApi({
          page: currentPage,
          pageSize,
          ...formValues,
        });
        return {
          items: res.data,
          total: res.total,
        };
      },
    },
  },
});
