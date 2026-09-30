import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    name: 'AiSelection',
    path: '/ai-selection',
    meta: { icon: 'lucide:sparkles', order: 20, title: 'AI 智选' },
    children: [
      {
        name: 'AiSelectionSearches',
        path: 'searches',
        component: () => import('#/views/ai-selection/searches/index.vue'),
        meta: { icon: 'lucide:search', title: '检索记录' },
      },
      {
        name: 'AiSelectionAnalytics',
        path: 'analytics',
        component: () => import('#/views/ai-selection/analytics/index.vue'),
        meta: { icon: 'lucide:chart-no-axes-combined', title: '趋势与统计' },
      },
      {
        name: 'SchemeList',
        path: '/scheme/list',
        component: () => import('#/views/scheme/list/index.vue'),
        meta: {
          icon: 'lucide:layout-grid',
          title: '方案列表',
        },
      },
      {
        name: 'SchemeCreate',
        path: '/scheme/create',
        component: () => import('#/views/scheme/detail/index.vue'),
        meta: {
          title: '新建方案',
          hideInMenu: true,
          activePath: '/scheme/list',
        },
      },
      {
        name: 'SchemeDetail',
        path: '/scheme/detail/:code',
        component: () => import('#/views/scheme/detail/index.vue'),
        meta: {
          title: '方案详情',
          hideInMenu: true,
          activePath: '/scheme/list',
        },
      },
    ],
  },
];

export default routes;
