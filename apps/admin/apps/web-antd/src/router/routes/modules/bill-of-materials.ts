import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    name: 'BillOfMaterialsManagement',
    path: '/bill-of-materials',
    component: () => import('#/views/bill-of-materials/list.vue'),
    meta: {
      icon: 'lucide:clipboard-list',
      order: 25,
      title: '清单管理',
    },
  },
];

export default routes;
