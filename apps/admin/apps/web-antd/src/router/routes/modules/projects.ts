import type { RouteRecordRaw } from 'vue-router';
const routes:RouteRecordRaw[]=[{path:'/projects',name:'Projects',component:()=>import('#/views/projects/list/index.vue'),meta:{title:'项目承接',icon:'lucide:briefcase-business',order:15,authority:['ROLE_ADMIN']}},
  {path:'/projects/:projectId',name:'ProjectDetail',component:()=>import('#/views/projects/detail.vue'),meta:{title:'项目工作区',hideInMenu:true,activePath:'/projects',authority:['ROLE_ADMIN']}}];
export default routes;
