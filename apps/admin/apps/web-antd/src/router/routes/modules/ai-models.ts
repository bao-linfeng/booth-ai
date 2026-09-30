import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/ai-models',
    name: 'AiModels',
    component: () => import('#/views/ai-models/index.vue'),
    meta: { title: 'AI 模型配置', icon: 'lucide:cpu', order: 35 },
  },
];

export default routes;
