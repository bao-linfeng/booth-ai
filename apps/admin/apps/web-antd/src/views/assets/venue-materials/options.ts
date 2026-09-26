import type { Ref } from 'vue';

import type { AssetType } from '#/api/core/assets';

import { listAssetsApi } from '#/api/core/assets';

export const createFormOptions = (schemeSearchConfig: {
  options: Ref<{ label: string; value: string }[]>;
  loading: Ref<boolean>;
  onSearch: (value: string) => void;
}) => ({
  schema: [
    {
      component: 'Select' as const,
      fieldName: 'schemeCode',
      label: '归属方案',
      componentProps: {
        options: schemeSearchConfig.options,
        loading: schemeSearchConfig.loading,
        showSearch: true,
        filterOption: false,
        allowClear: true,
        placeholder: '搜索方案编号或名称',
        onSearch: schemeSearchConfig.onSearch,
      },
    },
  ],
  showCollapseButton: false,
});

export const createGridOptions = (assetType: AssetType) => ({
  showOverflow: 'tooltip' as const,
  height: 'auto',
  toolbarConfig: { custom: true, refresh: true, zoom: true },
  columns: [
    { field: 'name', title: '资源名称', minWidth: 180 },
    { field: 'schemeCode', title: '方案编号', width: 140 },
    { field: 'schemeName', title: '所属方案', minWidth: 160 },
    {
      field: 'currentVersion',
      title: '文件名',
      width: 200,
      slots: { default: 'filename' },
    },
    {
      field: 'createdAt',
      title: '上传时间',
      width: 180,
      slots: { default: 'createdAt' },
    },
    {
      field: 'action',
      title: '操作',
      width: assetType === 'rendering' ? 180 : 120,
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
        const res = await listAssetsApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          type: assetType,
          ...formValues,
        });
        return { items: res.data, total: res.total };
      },
    },
  },
});
