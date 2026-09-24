import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/pages/Home.vue'),
    meta: {
      title: 'Home',
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

export default router