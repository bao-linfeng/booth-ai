import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:settings',
      order: 50,
      title: '系统配置',
    },
    name: 'SystemConfig',
    path: '/system',
    children: [
      {
        name: 'DictionaryList',
        path: '/dictionaries/list',
        component: () => import('#/views/dictionaries/index.vue'),
        meta: {
          icon: 'lucide:book-marked',
          title: '字典管理',
        },
      },
      {
        name: 'AiModels',
        path: '/ai-models',
        component: () => import('#/views/ai-models/index.vue'),
        meta: {
          icon: 'lucide:cpu',
          title: 'AI 模型配置',
        },
      },
      {
        name: 'PromptTemplates',
        path: '/prompt-templates',
        component: () => import('#/views/prompt-templates/index.vue'),
        meta: {
          icon: 'lucide:file-text',
          title: '提示词模板',
        },
      },
    ],
  },
];

export default routes;
