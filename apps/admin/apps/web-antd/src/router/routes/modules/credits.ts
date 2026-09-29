import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:coins',
      order: 60,
      title: '积分管理',
    },
    name: 'CreditManagement',
    path: '/credits',
    children: [
      {
        name: 'CreditList',
        path: 'list',
        component: () => import('#/views/credits/index.vue'),
        meta: {
          icon: 'lucide:list',
          title: '积分流水',
        },
      },
    ],
  },
];

export default routes;
