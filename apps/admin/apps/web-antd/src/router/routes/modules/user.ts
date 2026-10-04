import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:users',
      order: 10,
      title: '用户运营',
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
      {
        name: 'UserRoles',
        path: 'roles',
        component: () => import('#/views/user/roles/index.vue'),
        meta: { icon: 'lucide:shield-check', title: '用户角色' },
      },
      {
        name: 'CreditList',
        path: '/credits/list',
        component: () => import('#/views/credits/index.vue'),
        meta: {
          icon: 'lucide:coins',
          title: '积分流水',
        },
      },
    ],
  },
];

export default routes;
