import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    name: 'ProjectNotifications',
    path: '/notifications',
    component: () => import('#/views/notifications/index.vue'),
    meta: {
      icon: 'lucide:bell',
      title: '消息通知',
      hideInMenu: true,
    },
  },
];

export default routes;
