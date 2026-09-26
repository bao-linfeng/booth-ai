import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:users',
      order: 10,
      title: '用户管理',
    },
    name: 'UserManagement',
    path: '/user',
    children: [
      {
        name: 'UserList',
        path: 'list',
        component: () => import('#/views/user/list/index.vue'),
        meta: {
          icon: 'lucide:user',
          title: '用户列表',
        },
      },
      {
        name: 'AdminList',
        path: 'admins',
        component: () => import('#/views/user/admins/index.vue'),
        meta: {
          icon: 'lucide:shield-user',
          title: '管理员列表',
        },
      },
    ],
  },
];

export default routes;
