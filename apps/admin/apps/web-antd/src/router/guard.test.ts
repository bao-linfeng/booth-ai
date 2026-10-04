import type { RouteRecordRaw } from 'vue-router';

import { createMemoryHistory, createRouter } from 'vue-router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouterGuard } from './guard';
import { routes } from './routes';

const state = vi.hoisted(() => ({
  access: {
    homePath: '/home',
    permissions: ['home.read', 'questions.read'],
    routeNames: ['Home', 'ApplicabilityQuestions'],
  },
  store: {
    accessToken: 'test-token',
    isAccessChecked: false,
    setAccessCodes: vi.fn(),
    setAccessMenus: vi.fn(),
    setAccessRoutes: vi.fn(),
    setIsAccessChecked: vi.fn(),
  },
  user: { userInfo: { homePath: '/home', roles: [] as string[] } },
}));

vi.mock('@vben/constants', () => ({ LOGIN_PATH: '/auth/login' }));
vi.mock('@vben/preferences', () => ({
  preferences: {
    app: { defaultHomePath: '/home' },
    transition: { progress: false },
  },
}));
vi.mock('@vben/stores', () => ({
  useAccessStore: () => state.store,
  useUserStore: () => state.user,
}));
vi.mock('#/api/core/roles', () => ({
  getAdminAccessApi: vi.fn(async () => state.access),
}));
vi.mock('#/store', () => ({ useAuthStore: () => ({}) }));
vi.mock(
  '@vben/access',
  async () => import('../../../../packages/effects/access/src/accessible'),
);
vi.mock('#/router/routes', () => ({
  accessRoutes: [
    { name: 'Home', path: '/home', component: {} },
    {
      name: 'SystemConfig',
      path: '/system',
      children: [
        {
          name: 'ApplicabilityQuestions',
          path: '/applicability-questions',
          component: {},
        },
      ],
    },
  ],
  coreRouteNames: ['Root', 'Login'],
  routes: [
    {
      name: 'Root',
      path: '/',
      component: {},
      redirect: '/home',
      children: [],
    },
    { name: 'Login', path: '/auth/login', component: {} },
    {
      name: 'FallbackNotFound',
      path: '/:path(.*)*',
      component: {},
      meta: { hideInTab: true, title: '404' },
    },
  ],
}));

function setupRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((route) => ({
      ...route,
      children: [],
    })) as RouteRecordRaw[],
  });
  createRouterGuard(router);
  return router;
}

describe('admin route access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access = {
      homePath: '/home',
      permissions: ['home.read', 'questions.read'],
      routeNames: ['Home', 'ApplicabilityQuestions'],
    };
    state.store.accessToken = 'test-token';
    state.store.isAccessChecked = false;
    state.store.setIsAccessChecked.mockImplementation((checked: boolean) => {
      state.store.isAccessChecked = checked;
    });
  });

  it('sends a previously opened tab to 404 after its permission is revoked', async () => {
    const router = setupRouter();
    const tabPath = '/applicability-questions?source=tab#question';
    await router.push(tabPath);
    expect(router.currentRoute.value.name).toBe('ApplicabilityQuestions');
    await router.push('/home');

    state.access = {
      homePath: '/home',
      permissions: ['home.read'],
      routeNames: ['Home'],
    };
    await router.push(tabPath);

    expect(router.currentRoute.value.name).toBe('FallbackNotFound');
    expect(router.currentRoute.value.fullPath).toBe(tabPath);
    expect(router.hasRoute('ApplicabilityQuestions')).toBe(false);
    expect(router.hasRoute('SystemConfig')).toBe(false);
    expect(
      router
        .getRoutes()
        .find((route) => route.name === 'Root')
        ?.children.map((route) => route.name),
    ).toEqual(['Home']);
    expect(
      state.store.setAccessRoutes.mock.lastCall?.[0].map(
        (route: RouteRecordRaw) => route.name,
      ),
    ).toEqual(['Home']);
    expect(
      state.store.setAccessMenus.mock.lastCall?.[0].map(
        (menu: { path: string }) => menu.path,
      ),
    ).toEqual(['/home']);

    await router.push('/home');
    await router.push(tabPath);
    expect(router.currentRoute.value.name).toBe('FallbackNotFound');
    await router.push('/home');
    expect(router.currentRoute.value.name).toBe('Home');
  });

  it('shows 404 on a direct visit to an ungranted route', async () => {
    state.access = {
      homePath: '/home',
      permissions: ['home.read'],
      routeNames: ['Home'],
    };
    const router = setupRouter();
    await router.push('/applicability-questions');
    expect(router.currentRoute.value.name).toBe('FallbackNotFound');
    expect(router.currentRoute.value.path).toBe('/applicability-questions');
  });

  it('blocks a stale route record even when the permission signature is unchanged', async () => {
    state.access = {
      homePath: '/home',
      permissions: ['home.read'],
      routeNames: ['Home'],
    };
    const router = setupRouter();
    await router.push('/home');
    router.addRoute('Root', {
      name: 'ApplicabilityQuestions',
      path: '/applicability-questions',
      component: {},
    });

    await router.push('/applicability-questions?source=menu#question');
    expect(router.currentRoute.value.name).toBe('FallbackNotFound');
    expect(router.currentRoute.value.fullPath).toBe(
      '/applicability-questions?source=menu#question',
    );
  });

  it('restores access when the route permission is granted again', async () => {
    const router = setupRouter();
    await router.push('/home');
    state.access.routeNames = ['Home'];
    state.access.permissions = ['home.read'];
    await router.push('/applicability-questions');
    expect(router.currentRoute.value.name).toBe('FallbackNotFound');
    await router.push('/home');

    state.access.routeNames = ['Home', 'ApplicabilityQuestions'];
    state.access.permissions = ['home.read', 'questions.read'];
    await router.push('/applicability-questions');
    expect(router.currentRoute.value.name).toBe('ApplicabilityQuestions');
  });

  it('keeps login and unauthenticated navigation behavior', async () => {
    state.store.accessToken = '';
    const router = setupRouter();
    await router.push('/applicability-questions');
    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.redirect).toBe(
      encodeURIComponent('/applicability-questions'),
    );
  });
});
