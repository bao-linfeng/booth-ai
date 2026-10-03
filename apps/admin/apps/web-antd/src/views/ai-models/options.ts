import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { AiProviderRecord } from '#/api/core/ai-models';

import { getAiProvidersApi } from '#/api/core/ai-models';

/** `onLoaded` shares the fetched providers with the assignment tab so both views stay consistent. */
export function createProviderGridOptions(
  onLoaded: (items: AiProviderRecord[]) => void,
): VxeTableGridOptions<AiProviderRecord> {
  return {
    height: 'auto',
    showOverflow: 'tooltip',
    toolbarConfig: { refresh: true },
    pagerConfig: { enabled: false },
    expandConfig: { expandAll: true, padding: true },
    rowConfig: { keyField: 'id' },
    columns: [
      { type: 'expand', width: 48, slots: { content: 'models' } },
      { field: 'name', title: '供应商', minWidth: 140 },
      {
        field: 'protocol',
        title: '接口协议',
        width: 190,
        slots: { default: 'protocol' },
      },
      { field: 'baseUrl', title: 'Base URL', minWidth: 260 },
      {
        field: 'credentialConfigured',
        title: 'API Key',
        width: 100,
        slots: { default: 'credential' },
      },
      {
        field: 'enabled',
        title: '状态',
        width: 80,
        slots: { default: 'enabled' },
      },
      {
        field: 'models',
        title: '模型数',
        width: 80,
        slots: { default: 'modelCount' },
      },
      {
        field: 'catalogRefreshedAt',
        title: '模型目录',
        width: 200,
        slots: { default: 'catalog' },
      },
      {
        title: '操作',
        width: 290,
        fixed: 'right',
        slots: { default: 'actions' },
      },
    ],
    proxyConfig: {
      ajax: {
        query: async () => {
          const items = await getAiProvidersApi();
          onLoaded(items);
          return { items, total: items.length };
        },
      },
    },
  };
}
