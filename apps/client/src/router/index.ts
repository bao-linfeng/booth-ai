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
    path: '/hero',
    name: 'Hero Sections',
    component: () => import('@/pages/Layout.vue'),
    meta: {
      title: 'Hero Sections',
      description: 'Beautiful hero section components for your landing pages',
      isGroupParent: true
    },
    children: [
      {
        path: 'base',
        name: 'Hero Base',
        component: () => import('@/pages/hero/Hero.vue'),
        meta: { 
          icon: 'Layout',
          title: 'Hero Base',
          description: 'Standard hero section with image and text'
        }
      },
      {
        path: 'media',
        name: 'Hero Media',
        component: () => import('@/pages/hero/Media.vue'),
        meta: { 
          icon: 'Layout',
          title: 'Hero Media',
          description: 'Hero section with media'
        }
      },
      {
        path: 'promo',
        name: 'Hero Promo',
        component: () => import('@/pages/hero/Promo.vue'),
        meta: { 
          icon: 'Layout',
          title: 'Hero Promo',
          description: 'Hero section with promo'
        }
      },
      {
        path: 'split',
        name: 'Hero Split',
        component: () => import('@/pages/hero/Split.vue'),
        meta: { 
          icon: 'ChevronsRight',
          title: 'Hero Split',
          description: 'Split hero section with image and text'
        }
      },
      {
        path: 'split-full',
        name: 'Split Full',
        component: () => import('@/pages/hero/SplitFull.vue'),
        meta: { 
          icon: 'ChevronsRight',
          title: 'Split Full Hero',
          description: 'Split full hero section with image and text'
        }
      }
    ]
  },
  {
    path: '/blog',
    name: 'Blog Sections',
    component: () => import('@/pages/Layout.vue'),
    meta: {
      title: 'Blog Sections',
      description: 'Beautiful blog section components for your landing pages',
      isGroupParent: true
    },
    children: [
      {
        path: 'base',
        name: 'Blog Base',
        component: () => import('@/pages/blog/Grid.vue'),
        meta: { 
          icon: 'Layout',
          title: 'Blog Base',
          description: 'Standard blog section with image and text'
        }
      },
      {
        path: 'lists',
        name: 'Blog Lists',
        component: () => import('@/pages/blog/GridLists.vue'),
        meta: { 
          icon: 'Layout',
          title: 'Blog Lists',
          description: 'Blog section with lists'
        }
      }
    ]
  },
  {
    path: '/buildy/:pathMatch(.*)*',
    name: 'Buildy',
    component: () => import('@/pages/Layout.vue'),
    beforeEnter: () => {
      window.location.href = '/buildy/index.html'
    }
  },
  {
    path: '/reset/:pathMatch(.*)*',
    name: 'Reset',
    component: () => import('@/pages/Layout.vue'),
    beforeEnter: () => {
      window.location.href = '/'
    }
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
    component: () => import('@/pages/Layout.vue'),
    beforeEnter: (to) => {
      console.log('Caught unknown route:', to.fullPath)
      return { path: '/' }
    }
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
