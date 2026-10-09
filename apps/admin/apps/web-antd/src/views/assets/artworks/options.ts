import type { AssetType } from '#/api/core/assets';

import { listAssetsApi } from '#/api/core/assets';

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
