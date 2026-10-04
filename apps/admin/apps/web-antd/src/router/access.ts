import type { GenerateMenuAndRoutesOptions } from '@vben/types';

import { generateAccessible } from '@vben/access';

import { filterAuthorizedRoutes } from './authorized-routes';

async function generateAccess(options: GenerateMenuAndRoutesOptions, routeNames: string[]) {
  return generateAccessible('frontend', {
    ...options,
    routes: filterAuthorizedRoutes(options.routes, new Set(routeNames)),
    forbiddenComponent: () => import('#/views/_core/fallback/forbidden.vue'),
  });
}

export { generateAccess };
