import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/generation-jobs',
    name: 'GenerationJobs',
    component: () => import('#/views/generation-jobs/index.vue'),
    meta: { title: '生成任务', icon: 'lucide:cpu', order: 16 },
  },
];

export default routes;
