import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:book-marked',
      order: 30,
      title: '字典管理',
    },
    name: 'DictionaryManagement',
    path: '/dictionaries',
    children: [
      {
        name: 'DictionaryList',
        path: 'list',
        component: () => import('#/views/dictionaries/index.vue'),
        meta: {
          icon: 'lucide:list',
          title: '字典列表',
        },
      },
    ],
  },
];

export default routes;
