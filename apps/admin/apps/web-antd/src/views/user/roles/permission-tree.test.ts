import type { RouteRecordRaw } from 'vue-router';

import type { PermissionDefinition } from '#/api/core/roles';

import { describe, expect, it } from 'vitest';

import {
  actionCodeMap,
  buildPermissionTree,
  diffTreeSelection,
  toTreeSelection,
} from './permission-tree';

function def(
  groupKey: string,
  group: string,
  action: string,
  routes: string[],
): PermissionDefinition {
  return {
    code: `${groupKey}.${action}`,
    label: `${group}-${action}`,
    group,
    groupKey,
    routes,
    kind: action === 'read' ? 'route' : 'action',
    requires: action === 'read' ? [] : [`${groupKey}.read`],
  };
}

const catalog = [
  def('users', '用户列表', 'read', ['UserList']),
  def('assets', '资源管理', 'read', ['AssetsMasks', 'AssetsArtworks']),
  def('assets', '资源管理', 'write', ['AssetsMasks', 'AssetsArtworks']),
  def('notifications', '消息通知', 'read', ['ProjectNotifications']),
  def('schemes', '方案管理', 'read', ['SchemeList', 'SchemeDetail']),
  def('audit', '审计日志', 'read', []),
];

const routes: RouteRecordRaw[] = [
  {
    path: '/notifications',
    name: 'ProjectNotifications',
    component: {},
    meta: { title: '消息通知', hideInMenu: true },
  },
  {
    path: '/assets',
    name: 'Assets',
    meta: { title: '资源管理', order: 20 },
    children: [
      {
        path: 'masks',
        name: 'AssetsMasks',
        component: {},
        meta: { title: '蒙版' },
      },
      {
        path: 'artworks',
        name: 'AssetsArtworks',
        component: {},
        meta: { title: '平面素材' },
      },
    ],
  },
  {
    path: '/user',
    name: 'UserManagement',
    meta: { title: '用户运营', order: 10, icon: 'lucide:users' },
    children: [
      {
        path: 'list',
        name: 'UserList',
        component: {},
        meta: { title: '用户列表' },
      },
      {
        path: 'other',
        name: 'Unmapped',
        component: {},
        meta: { title: '未登记页面' },
      },
    ],
  },
  {
    path: '/ai',
    name: 'AiSelection',
    meta: { title: 'AI 智选', order: 20 },
    children: [
      {
        path: '/scheme/list',
        name: 'SchemeList',
        component: {},
        meta: { title: '方案列表' },
      },
      {
        path: '/scheme/detail/:code',
        name: 'SchemeDetail',
        component: {},
        meta: {
          title: '方案详情',
          hideInMenu: true,
          activePath: '/scheme/list',
        },
      },
    ],
  },
  {
    path: '/empty',
    name: 'Empty',
    meta: { title: '空目录' },
    children: [
      {
        path: 'x',
        name: 'Unmapped2',
        component: {},
        meta: { title: '无权限页面' },
      },
    ],
  },
];

describe('permission tree from admin routes', () => {
  const tree = buildPermissionTree(routes, catalog);
  const [notifications, user, assets, ai, other] = tree;

  it('orders level-1 entries like the menu and nests real pages under them', () => {
    expect(tree.map((node) => node.title)).toEqual([
      '消息通知',
      '用户运营',
      '资源管理',
      'AI 智选',
      '其他',
    ]);
    expect(user?.type).toBe('menu');
    expect(user?.icon).toBe('lucide:users');
    expect(user?.children?.map((node) => node.title)).toEqual(['用户列表']);
    expect(assets?.children?.map((node) => node.title)).toEqual([
      '蒙版',
      '平面素材',
    ]);
  });

  it('puts operations as leaves under pages, treats top-level leaf routes as pages and drops unmapped ones', () => {
    expect(notifications?.type).toBe('page');
    expect(notifications?.children?.map((node) => node.code)).toEqual([
      'notifications.read',
    ]);
    const leaf = user?.children?.[0]?.children?.[0];
    expect(leaf).toMatchObject({
      type: 'action',
      code: 'users.read',
      title: '用户列表-read',
    });
    expect(leaf?.children).toBeUndefined();
    expect(tree.some((node) => node.title === '空目录')).toBe(false);
  });

  it('marks pages sharing one permission group with unique node ids, and skips sub-pages', () => {
    const [masks, artworks] = assets?.children ?? [];
    expect(masks?.sharedWith).toEqual(['平面素材']);
    expect(artworks?.sharedWith).toEqual(['蒙版']);
    expect(masks?.children?.[0]?.id).not.toBe(artworks?.children?.[0]?.id);
    expect(ai?.children?.map((node) => node.title)).toEqual(['方案列表']);
    expect(ai?.children?.[0]?.sharedWith).toEqual([]);
  });

  it('lists permission modules without a page under 其他 so they stay grantable', () => {
    expect(other?.children?.map((node) => node.title)).toEqual(['审计日志']);
    expect(other?.children?.[0]?.children?.map((node) => node.code)).toEqual([
      'audit.read',
    ]);
  });

  it('maps every catalog code to at least one action node', () => {
    expect(new Set(actionCodeMap(tree).values())).toEqual(
      new Set(catalog.map((item) => item.code)),
    );
  });
});

describe('tree selection <-> permission codes', () => {
  const tree = buildPermissionTree(routes, catalog);
  const masksRead = 'action:AssetsMasks:assets.read';
  const artworksRead = 'action:AssetsArtworks:assets.read';

  it('selects every copy of a shared permission and parents whose operations are all granted', () => {
    const selected = toTreeSelection(tree, ['assets.read']);
    expect(selected).toContain(masksRead);
    expect(selected).toContain(artworksRead);
    expect(selected).not.toContain('page:AssetsMasks');
    const full = toTreeSelection(tree, ['assets.read', 'assets.write']);
    expect(full).toEqual(
      expect.arrayContaining([
        'page:AssetsMasks',
        'page:AssetsArtworks',
        'menu:Assets',
      ]),
    );
    expect(toTreeSelection(tree, [])).toEqual([]);
  });

  it('diffs only operation nodes into added and removed codes', () => {
    const before = toTreeSelection(tree, ['assets.read']);
    const checkWrite = [...before, 'action:AssetsMasks:assets.write'];
    expect(diffTreeSelection(tree, before, checkWrite)).toEqual({
      added: ['assets.write'],
      removed: [],
    });
    expect(
      diffTreeSelection(
        tree,
        before,
        before.filter((id) => id !== masksRead),
      ),
    ).toEqual({ added: [], removed: ['assets.read'] });
    expect(
      diffTreeSelection(tree, [], ['menu:Assets', 'page:AssetsMasks']),
    ).toEqual({ added: [], removed: [] });
    const all = actionCodeMap(tree);
    expect(
      diffTreeSelection(tree, [], [...all.keys()]).added.toSorted(),
    ).toEqual([...new Set(all.values())].toSorted());
  });
});

describe('i18n route titles', () => {
  it('translates meta.title keys (menu, pages and shared-with labels) with the given translator', () => {
    const i18nCatalog = [
      def('dashboard', '工作台', 'read', ['Analytics', 'Workspace']),
    ];
    const i18nRoutes: RouteRecordRaw[] = [
      {
        path: '/dashboard',
        name: 'Dashboard',
        meta: { title: 'page.dashboard.title' },
        children: [
          {
            path: 'a',
            name: 'Analytics',
            component: {},
            meta: { title: 'page.dashboard.analytics' },
          },
          {
            path: 'w',
            name: 'Workspace',
            component: {},
            meta: { title: 'page.dashboard.workspace' },
          },
        ],
      },
    ];
    const messages: Record<string, string> = {
      'page.dashboard.analytics': '分析页',
      'page.dashboard.title': '概览',
      'page.dashboard.workspace': '工作台',
    };
    const [menu] = buildPermissionTree(
      i18nRoutes,
      i18nCatalog,
      (key) => messages[key] ?? key,
    );
    expect(menu?.title).toBe('概览');
    expect(menu?.children?.map((page) => page.title)).toEqual([
      '分析页',
      '工作台',
    ]);
    expect(menu?.children?.[0]?.sharedWith).toEqual(['工作台']);
    // 不传翻译函数时保持原样
    expect(buildPermissionTree(i18nRoutes, i18nCatalog)[0]?.title).toBe(
      'page.dashboard.title',
    );
  });
});

describe('page-specific actions', () => {
  it('combines groups on one page without copying actions to sibling pages', () => {
    const definitions = [
      def('assets-masks', '蒙版', 'read', ['AssetsMasks']),
      def('assets-masks', '蒙版', 'upload', ['AssetsMasks']),
      def('assets-artworks', '平面素材', 'read', ['AssetsArtworks']),
      def('assets-artworks', '平面素材', 'download', ['AssetsArtworks']),
      def('schemes', '方案', 'read', ['SchemeList', 'SchemeDetail']),
      def('assets-models', '模型', 'upload', ['SchemeList', 'SchemeDetail']),
    ];
    const tree = buildPermissionTree(routes, definitions);
    const assets = tree.find((node) => node.title === '资源管理');
    const [masks, artworks] = assets?.children ?? [];
    expect(masks?.children?.map((node) => node.code)).toEqual([
      'assets-masks.read',
      'assets-masks.upload',
    ]);
    expect(artworks?.children?.map((node) => node.code)).toEqual([
      'assets-artworks.read',
      'assets-artworks.download',
    ]);
    expect(masks?.sharedWith).toEqual([]);
    expect(artworks?.sharedWith).toEqual([]);
    const schemes = tree.find((node) => node.title === 'AI 智选')
      ?.children?.[0];
    expect(schemes?.children?.map((node) => node.code)).toEqual([
      'schemes.read',
      'assets-models.upload',
    ]);
    const selected = toTreeSelection(tree, [
      'assets-masks.read',
      'assets-masks.upload',
    ]);
    expect(selected).toContain('page:AssetsMasks');
    expect(selected).not.toContain('page:AssetsArtworks');
    expect(new Set(actionCodeMap(tree).values())).toEqual(
      new Set(definitions.map((item) => item.code)),
    );
  });

  it('uses each permission routes even when a group contains different page scopes', () => {
    const tree = buildPermissionTree(routes, [
      def('assets', '资源', 'read', ['AssetsMasks', 'AssetsArtworks']),
      def('assets', '资源', 'preview', ['AssetsMasks']),
      def('assets', '资源', 'download', ['AssetsArtworks']),
    ]);
    const [masks, artworks] = tree[0]?.children ?? [];
    expect(masks?.children?.map((node) => node.code)).toEqual([
      'assets.read',
      'assets.preview',
    ]);
    expect(artworks?.children?.map((node) => node.code)).toEqual([
      'assets.read',
      'assets.download',
    ]);
    expect(masks?.sharedWith).toEqual([]);
    expect(tree.some((node) => node.title === '其他')).toBe(false);
  });
});
