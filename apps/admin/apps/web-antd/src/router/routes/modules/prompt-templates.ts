import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/prompt-templates',
    name: 'PromptTemplates',
    component: () => import('#/views/prompt-templates/index.vue'),
    meta: { title: '提示词模板', icon: 'lucide:file-text', order: 36 },
  },
];

export default routes;
