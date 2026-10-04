import type { RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { filterAuthorizedRoutes } from './authorized-routes';

describe('server-authorized admin routes', () => {
  const routes: RouteRecordRaw[] = [
    { path: '/user', name: 'Users', children: [
      { path: 'list', name: 'UserList', component: {} },
      { path: 'roles', name: 'UserRoles', component: {} },
    ] },
    { path: '/projects', name: 'Projects', children: [{ path: 'list', name: 'ProjectList', component: {} }] },
    { path: '/profile', name: 'Profile', component: {} },
  ];

  it('keeps only server-authorized leaves and redirects groups to an authorized child', () => {
    const result = filterAuthorizedRoutes(routes, new Set(['UserRoles', 'Profile']));
    expect(result.map(route => route.name)).toEqual(['Users', 'Profile']);
    expect(result[0]?.children?.map(route => route.name)).toEqual(['UserRoles']);
    expect(result[0]?.redirect).toEqual({ name: 'UserRoles' });
    expect(routes[0]?.children).toHaveLength(2);
  });

  it('removes previously granted routes after permission revocation', () => {
    expect(filterAuthorizedRoutes(routes, new Set(['Profile']))).toEqual([routes[2]]);
    expect(filterAuthorizedRoutes(routes, new Set())).toEqual([]);
  });
});
