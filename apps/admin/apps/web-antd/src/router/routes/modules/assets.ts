import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'ant-design:picture-outlined',
      order: 20,
      title: '资源管理',
    },
    name: 'Assets',
    path: '/assets',
    children: [
      {
        meta: { title: '效果图', icon: 'ant-design:file-image-outlined' },
        name: 'AssetsRenderings',
        path: '/assets/renderings',
        component: () => import('#/views/assets/renderings/index.vue'),
      },
      {
        meta: { title: '蒙版', icon: 'ant-design:bg-colors-outlined' },
        name: 'AssetsMasks',
        path: '/assets/masks',
        component: () => import('#/views/assets/masks/index.vue'),
      },
      {
        meta: { title: '报馆图', icon: 'ant-design:file-pdf-outlined' },
        name: 'AssetsVenueMaterials',
        path: '/assets/venue-materials',
        component: () => import('#/views/assets/venue-materials/index.vue'),
      },
      {
        meta: { title: '平面素材', icon: 'ant-design:layout-outlined' },
        name: 'AssetsArtworks',
        path: '/assets/artworks',
        component: () => import('#/views/assets/artworks/index.vue'),
      },
    ],
  },
];

export default routes;
