import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { externalLoginGuard } from './external-login'

export const routes: RouteRecordRaw[] = [
  { path: '/schemes/:code/artwork', name: 'ArtworkGeneration', component: () => import('@/pages/ArtworkJob.vue'), meta: { title: '四面素材生成' } },
  { path: '/artwork-jobs/:jobId', name: 'ArtworkJob', component: () => import('@/pages/ArtworkJob.vue'), meta: { title: '四面素材与交付' } },
  { path: '/my-projects', name: 'MyProjects', component: () => import('@/pages/MyProjects.vue'), meta: { title: '我的项目' } },
  { path: '/my-projects/:projectId', name: 'MyProjectDetail', component: () => import('@/pages/MyProjects.vue'), meta: { title: '项目详情' } },
  { path: '/my-searches', name: 'MySearches', component: () => import('@/pages/MySearches.vue'), meta: { title: '检索记录' } },
  { path: '/manual-request', name: 'ManualRequest', component: () => import('@/pages/ManualRequest.vue'), meta: { title: '人工需求申请' } },
  {
    path: '/schemes/:code/quote',
    name: 'QuoteRequest',
    component: () => import('@/pages/QuoteRequest.vue'),
    meta: { title: '申请报价' },
  },
  {
    path: '/ai-selection',
    name: 'AISelection',
    component: () => import('@/pages/AISelection.vue'),
    meta: { title: 'AI 智选' },
  },
  {
    path: '/ai-selection/preview',
    name: 'AISelectionPreview',
    component: () => import('@/pages/AISelection.vue'),
    meta: { title: 'AI 智选 · 静态预览' },
  },
  {
    path: '/ai-selection/preview/schemes/:code',
    name: 'SchemePreview',
    component: () => import('@/pages/SchemeDetail.vue'),
    meta: { title: '方案详情 · 静态预览' },
  },
  {
    path: '/schemes/:code',
    name: 'SchemeDetail',
    component: () => import('@/pages/SchemeDetail.vue'),
    meta: { title: '方案详情' },
  },
  {
    path: '/schemes/:code/theme',
    name: 'SchemeTheme',
    component: () => import('@/pages/SchemeTheme.vue'),
    meta: { title: 'AI 换主题' },
  },
  {
    path: '/ai-selection/preview/schemes/:code/theme',
    name: 'SchemeThemePreview',
    component: () => import('@/pages/SchemeTheme.vue'),
    meta: { title: 'AI 换主题 · 静态预览' },
  },
  {
    path: '/theme-jobs/:jobId',
    name: 'ThemeJob',
    component: () => import('@/pages/ThemeJob.vue'),
    meta: { title: 'AI 换主题结果' },
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('@/pages/Home.vue'),
    meta: {
      title: 'AI 智选',
      icon: 'Home'
    }
  },
  {
    path: '/buildy/:pathMatch(.*)*',
    name: 'Buildy',
    component: () => import('@/pages/BuildyRedirect.vue'),
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/pages/Profile.vue'),
    meta: { title: '个人中心' }
  },
  {
    path: '/auth/sign-in',
    name: 'SignIn',
    component: () => import('@/pages/auth/SignIn.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    redirect: '/',
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0, behavior: 'smooth' }
  }
})

router.beforeEach(externalLoginGuard)

export default router
