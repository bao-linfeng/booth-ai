import { getSchemeListApi } from '#/api/core/schemes';

export const createFormOptions = (
  styleOptions: { label: string; value: string }[] = [],
  productSystemOptions: { label: string; value: string }[] = [],
  industryOptions: { label: string; value: string }[] = [],
  openingCountOptions: { label: string; value: number }[] = [],
  budgetTierOptions: { label: string; value: string }[] = [],
  zoneOptions: { label: string; value: string }[] = [],
  featureOptions: { label: string; value: string }[] = [],
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
      fieldName: 'styleId',
      label: '风格',
      componentProps: {
        placeholder: '请选择风格',
        options: styleOptions.length > 0 ? styleOptions : [],
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'productSystemId',
      label: '产品体系',
      componentProps: {
        placeholder: '请选择产品体系',
        options: productSystemOptions,
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'industryId',
      label: '适用行业',
      componentProps: { placeholder: '请选择行业', options: industryOptions },
    },
    {
      component: 'Select' as const,
      fieldName: 'openingCount',
      label: '开口面数',
      componentProps: {
        placeholder: '请选择开口面数',
        options: openingCountOptions,
        allowClear: true,
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'budgetTierId',
      label: '预算档位',
      componentProps: {
        placeholder: '请选择预算档位',
        options: budgetTierOptions,
        allowClear: true,
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'zoneIds',
      label: '功能分区',
      componentProps: {
        placeholder: '请选择功能分区',
        options: zoneOptions,
        mode: 'multiple',
        allowClear: true,
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'featureIds',
      label: '关键特征',
      componentProps: {
        placeholder: '请选择关键特征',
        options: featureOptions,
        mode: 'multiple',
        allowClear: true,
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
  sortConfig: { trigger: 'cell' as const, remote: true },
  columns: [
    { field: 'code', title: '方案编号', width: 140, fixed: 'left' as const },
    { field: 'name', title: '方案名称', minWidth: 160, fixed: 'left' as const },
    {
      field: 'publishStatus',
      title: '发布状态',
      width: 90,
      slots: { default: 'publishStatus' },
    },
    {
      field: 'verificationStatus',
      title: '核验状态',
      width: 90,
      slots: { default: 'verificationStatus' },
    },
    {
      field: 'assetCounts',
      title: '资产清单',
      width: 200,
      slots: { default: 'assetCounts' },
    },
    {
      field: 'latestReview',
      title: '最近审核',
      width: 120,
      slots: { default: 'latestReview' },
    },
    {
      field: 'lastUnpublishReason',
      title: '最近下架原因',
      minWidth: 150,
      slots: { default: 'lastUnpublishReason' },
    },
    {
      field: 'dimensions',
      title: '尺寸(长×宽×高 mm)',
      width: 180,
      slots: { default: 'dimensions' },
    },
    { field: 'areaM2', title: '面积(m²)', width: 90 },
    {
      field: 'openingCount',
      title: '开口面数',
      width: 90,
      slots: { default: 'openingCount' },
    },
    {
      field: 'productSystemId',
      title: '产品体系',
      width: 110,
      slots: { default: 'productSystem' },
    },
    {
      field: 'styleId',
      title: '风格',
      width: 90,
      slots: { default: 'style' },
    },
    {
      field: 'updatedAt',
      title: '更新时间',
      minWidth: 170,
      sortable: true,
    },
    { field: 'createdAt', title: '创建时间', minWidth: 170 },
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
    sort: true,
    ajax: {
      query: async ({ page, sort }: any, formValues: any = {}) => {
        const hasSort = sort?.field && sort?.order;
        const res = await getSchemeListApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          sortBy: hasSort ? sort.field : 'updatedAt',
          sortOrder: hasSort ? sort.order : 'desc',
          ...formValues,
        });
        return { items: res.data, total: res.total };
      },
    },
  },
});
