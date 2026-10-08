import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:headset',
      order: 16,
      title: '在线客服',
    },
    name: 'CustomerService',
    path: '/customer-service',
    children: [
      {
        name: 'CustomerServiceWorkbench',
        path: 'workbench',
        component: () => import('#/views/customer-service/workbench/index.vue'),
        meta: {
          // 切换会话只改 query，不能按 fullPath 新开标签页并重建页面
          fullPathKey: false,
          icon: 'lucide:messages-square',
          title: '客服工作台',
        },
      },
      {
        name: 'CustomerServiceSettings',
        path: 'settings',
        component: () => import('#/views/customer-service/settings/index.vue'),
        meta: {
          icon: 'lucide:settings-2',
          title: '客服设置',
        },
      },
    ],
  },
];

export default routes;
