import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { analyticsRangeDays, getDashboardAnalytics, type AnalyticsRangeDays } from '../../../modules/dashboard/analytics.js';
import { getDashboardWorkspace } from '../../../modules/dashboard/workspace.js';
import { adminUserId, requirePrincipal } from '../../authentication.js';

export async function registerAdminDashboardRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/dashboard/workspace', { config: { permissions: ['workspace.read'] }, schema: { tags: ['admin-dashboard'] } }, async request => ({
    code: 0, data: await getDashboardWorkspace(pool, adminUserId(request), requirePrincipal(request, 'admin').permissions),
  }));

  app.get('/dashboard/analytics', { config: { permissions: ['dashboard.read'] }, schema: { tags: ['admin-dashboard'], querystring: {
    type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: [...analyticsRangeDays] } },
  } } }, async request => ({
    code: 0, data: await getDashboardAnalytics(pool, requirePrincipal(request, 'admin').permissions,
      (request.query as { days?: AnalyticsRangeDays }).days ?? 30),
  }));
}
