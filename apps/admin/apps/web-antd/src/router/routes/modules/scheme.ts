import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:layout-grid',
      order: 20,
      title: '方案管理',
    },
    name: 'SchemeManagement',
    path: '/scheme',
    children: [
      {
        name: 'SchemeList',
        path: 'list',
        component: () => import('#/views/scheme/list/index.vue'),
        meta: {
          icon: 'lucide:list',
          title: '方案列表',
        },
      },
      {
        name: 'SchemeCreate',
        path: 'create',
        component: () => import('#/views/scheme/detail/index.vue'),
        meta: {
          title: '新建方案',
          hideInMenu: true,
        },
      },
      {
        name: 'SchemeDetail',
        path: 'detail/:code',
        component: () => import('#/views/scheme/detail/index.vue'),
        meta: {
          title: '方案详情',
          hideInMenu: true,
        },
      },
    ],
  },
];

export default routes;
