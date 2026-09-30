import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:briefcase-business',
      order: 15,
      title: '项目管理',
      authority: ['ROLE_ADMIN'],
    },
    name: 'Projects',
    path: '/projects',
    children: [
      {
        name: 'ProjectList',
        path: 'list',
        component: () => import('#/views/projects/list/index.vue'),
        meta: {
          icon: 'lucide:clipboard',
          title: '项目承接',
          authority: ['ROLE_ADMIN'],
        },
      },
      {
        name: 'GenerationJobs',
        path: '/generation-jobs',
        component: () => import('#/views/generation-jobs/index.vue'),
        meta: {
          icon: 'lucide:cpu',
          title: '生成任务',
        },
      },
      {
        name: 'BillOfMaterialsManagement',
        path: '/bill-of-materials',
        component: () => import('#/views/bill-of-materials/list.vue'),
        meta: {
          icon: 'lucide:clipboard-list',
          title: '清单管理',
        },
      },
    ],
  },
  {
    path: '/projects/:projectId',
    name: 'ProjectDetail',
    component: () => import('#/views/projects/detail.vue'),
    meta: {
      title: '项目工作区',
      hideInMenu: true,
      activePath: '/projects',
      authority: ['ROLE_ADMIN'],
    },
  },
];

export default routes;
