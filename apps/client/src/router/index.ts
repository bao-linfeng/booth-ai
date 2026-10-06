import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { externalLoginGuard } from './external-login'

export const routes: RouteRecordRaw[] = [
  { path: '/schemes/:code/artwork', name: 'ArtworkGeneration', component: () => import('@/pages/ArtworkJob.vue'), meta: { titleKey: 'titles.artworkGeneration' } },
  { path: '/artwork-jobs/:jobId', name: 'ArtworkJob', component: () => import('@/pages/ArtworkJob.vue'), meta: { titleKey: 'titles.artworkJob' } },
  { path: '/my-projects', name: 'MyProjects', component: () => import('@/pages/MyProjects.vue'), meta: { titleKey: 'titles.myProjects' } },
  { path: '/my-projects/:projectId', name: 'MyProjectDetail', component: () => import('@/pages/MyProjects.vue'), meta: { titleKey: 'titles.projectDetail' } },
  { path: '/my-searches', name: 'MySearches', component: () => import('@/pages/MySearches.vue'), meta: { titleKey: 'titles.mySearches' } },
  { path: '/manual-request', name: 'ManualRequest', component: () => import('@/pages/ManualRequest.vue'), meta: { titleKey: 'titles.manualRequest' } },
  {
    path: '/schemes/:code/quote',
    name: 'QuoteRequest',
    component: () => import('@/pages/QuoteRequest.vue'),
    meta: { titleKey: 'titles.quoteRequest' },
  },
  {
    path: '/ai-selection',
    name: 'AISelection',
    component: () => import('@/pages/AISelection.vue'),
    meta: { titleKey: 'titles.aiSelection' },
  },
  {
    path: '/ai-selection/preview',
    name: 'AISelectionPreview',
    component: () => import('@/pages/AISelection.vue'),
    meta: { titleKey: 'titles.aiSelectionPreview' },
  },
  {
    path: '/ai-selection/preview/schemes/:code',
    name: 'SchemePreview',
    component: () => import('@/pages/SchemeDetail.vue'),
    meta: { titleKey: 'titles.schemePreview' },
  },
  {
    path: '/schemes/:code',
    name: 'SchemeDetail',
    component: () => import('@/pages/SchemeDetail.vue'),
    meta: { titleKey: 'titles.schemeDetail' },
  },
  {
    path: '/schemes/:code/theme',
    name: 'SchemeTheme',
    component: () => import('@/pages/SchemeTheme.vue'),
    meta: { titleKey: 'titles.schemeTheme' },
  },
  {
    path: '/ai-selection/preview/schemes/:code/theme',
    name: 'SchemeThemePreview',
    component: () => import('@/pages/SchemeTheme.vue'),
    meta: { titleKey: 'titles.schemeThemePreview' },
  },
  {
    path: '/theme-jobs/:jobId',
    name: 'ThemeJob',
    component: () => import('@/pages/ThemeJob.vue'),
    meta: { titleKey: 'titles.themeJob' },
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('@/pages/Home.vue'),
    meta: {
      titleKey: 'titles.aiSelection',
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
    meta: { titleKey: 'titles.profile' }
  },
  {
    path: '/auth/sign-in',
    name: 'SignIn',
    component: () => import('@/pages/auth/SignIn.vue'),
    meta: { titleKey: 'titles.signIn' }
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
