import type { ProjectQuery } from '#/api/core/projects';

import { listProjectsApi, statusLabels } from '#/api/core/projects';

/** 「只看我负责的」开关状态记在本地，默认开启 */
export const MINE_STORAGE_KEY = 'booth-admin:projects:only-mine';
export function storedOnlyMine(): boolean {
  try {
    return localStorage.getItem(MINE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}
export function storeOnlyMine(value: boolean) {
  try {
    localStorage.setItem(MINE_STORAGE_KEY, String(value));
  } catch {
    // 存储不可用时只影响下次打开的默认值
  }
}

type ListFormValues = Omit<ProjectQuery, 'mine'> & { mine?: boolean };

/**
 * 组装列表查询：选了「分配情况」时忽略「只看我负责的」，否则待分配项目（没有承接人）永远查不到，无法领取。
 */
export function listQuery(values: ListFormValues): ProjectQuery {
  const { mine, ...query } = values;
  return {
    ...query,
    ...(mine && !query.assignment ? { mine: true } : {}),
  };
}

export const createFormOptions = () => ({
  schema: [
    {
      component: 'Switch' as const,
      fieldName: 'mine',
      label: '只看我负责的',
      defaultValue: storedOnlyMine(),
      help: '选择「分配情况」筛选时不生效，便于查看和领取待分配项目',
      componentProps: {
        onChange: (value: boolean) => storeOnlyMine(value),
      },
    },
    {
      component: 'Select' as const,
      fieldName: 'followUp',
      label: '跟进提醒',
      componentProps: {
        allowClear: true,
        placeholder: '全部',
        options: [
          { value: 'overdue', label: '已逾期' },
          { value: 'today', label: '今天到期' },
        ],
      },
    },
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
    {
      component: 'Select' as const,
      fieldName: 'assignment',
      label: '分配情况',
      componentProps: {
        allowClear: true,
        placeholder: '全部',
        options: [
          { value: 'unassigned', label: '待分配' },
          { value: 'needs_assignment', label: '需处理分配' },
        ],
      },
      help: '需处理分配：待分配，或承接人已停用/缺少权限且项目未结束',
    },
    {
      component: 'Select' as const,
      fieldName: 'assigneeAdminId',
      label: '承接人',
      componentProps: {
        allowClear: true,
        placeholder: '请选择承接人',
        options: [],
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
      field: 'nextFollowUpAt',
      title: '下次跟进',
      minWidth: 170,
      slots: { default: 'nextFollowUp' },
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
      width: 220,
      fixed: 'right' as const,
      slots: { default: 'action' },
    },
  ],
  pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
  proxyConfig: {
    enabled: true,
    autoLoad: true,
    ajax: {
      query: async ({ page }: any, formValues: ListFormValues = {}) => {
        const res = await listProjectsApi({
          ...listQuery(formValues),
          page: page.currentPage,
          pageSize: page.pageSize,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
});
