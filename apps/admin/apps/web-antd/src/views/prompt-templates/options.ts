import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';
import type {
  ListTemplatesQuery,
  PromptTemplate,
} from '#/api/core/prompt-templates';

import { listPromptTemplatesApi } from '#/api/core/prompt-templates';

export const createFormOptions = (
  industryOptions: { label: string; value: string }[] = [],
  styleOptions: { label: string; value: string }[] = [],
): VbenFormProps => ({
  schema: [
    {
      component: 'Select' as const,
      fieldName: 'purpose',
      label: '用途',
      componentProps: {
        placeholder: '请选择',
        allowClear: true,
        options: [
          { label: 'AI 智选 · 需求解析', value: 'filter' },
          { label: 'AI 换主题', value: 'theme' },
          { label: 'AI 四向图', value: 'artwork' },
        ],
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'industryId',
      label: '行业',
      dependencies: {
        triggerFields: ['purpose'],
        show(values) {
          return values.purpose !== 'filter';
        },
      },
      componentProps: {
        placeholder: '请选择',
        allowClear: true,
        options: industryOptions,
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'styleId',
      label: '风格',
      dependencies: {
        triggerFields: ['purpose'],
        show(values) {
          return values.purpose !== 'filter';
        },
      },
      componentProps: {
        placeholder: '请选择',
        allowClear: true,
        options: styleOptions,
      },
    },
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

export const createGridOptions = (): VxeGridProps<PromptTemplate> => ({
  showOverflow: 'tooltip' as const,
  height: 'auto',
  toolbarConfig: { custom: true, refresh: true, zoom: true },
  columns: [
    {
      field: 'purpose',
      title: '用途',
      width: 160,
      slots: { default: 'purpose' },
    },
    {
      field: 'industryId',
      title: '适用行业',
      minWidth: 120,
      slots: { default: 'industryId' },
    },
    {
      field: 'styleId',
      title: '适用风格',
      minWidth: 120,
      slots: { default: 'styleId' },
    },
    {
      field: 'bodyPreview',
      title: '模板正文',
      minWidth: 200,
      slots: { default: 'bodyPreview' },
    },
    {
      field: 'enabled',
      title: '状态',
      width: 80,
      slots: { default: 'enabled' },
    },
    { field: 'revision', title: '修订', width: 70 },
    { field: 'updatedAt', title: '更新时间', width: 170 },
    {
      field: 'action',
      title: '操作',
      width: 120,
      fixed: 'right' as const,
      slots: { default: 'action' },
    },
  ],
  pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
  proxyConfig: {
    enabled: true,
    autoLoad: true,
    ajax: {
      query: async ({ page }, formValues: ListTemplatesQuery = {}) => {
        const res = await listPromptTemplatesApi({
          page: page.currentPage,
          pageSize: page.pageSize,
          purpose: formValues.purpose || undefined,
          enabled:
            typeof formValues.enabled === 'boolean'
              ? formValues.enabled
              : undefined,
          industryId:
            formValues.purpose === 'filter'
              ? undefined
              : formValues.industryId || undefined,
          styleId:
            formValues.purpose === 'filter'
              ? undefined
              : formValues.styleId || undefined,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
});
