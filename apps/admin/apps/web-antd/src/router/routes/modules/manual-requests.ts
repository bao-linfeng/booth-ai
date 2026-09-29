import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [{
  path: '/manual-requests', name: 'ManualRequests', component: () => import('#/views/manual-requests/index.vue'),
  meta: { title: '人工需求', icon: 'lucide:messages-square', order: 15 },
}];

export default routes;
