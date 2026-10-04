import type { RouteRecordRaw } from 'vue-router';

export function filterAuthorizedRoutes(routes: RouteRecordRaw[], allowed: Set<string>): RouteRecordRaw[] {
  return routes.flatMap((route) => {
    if (route.children?.length) {
      const children = filterAuthorizedRoutes(route.children, allowed);
      if (children.length === 0) return [];
      return [{ ...route, children, redirect: { name: children[0]!.name } } as RouteRecordRaw];
    }
    return typeof route.name === 'string' && allowed.has(route.name) ? [{ ...route }] : [];
  });
}
