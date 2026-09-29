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
    ],
  },
];

export default routes;
