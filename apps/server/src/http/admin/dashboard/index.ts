import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { analyticsRangeDays, getDashboardAnalytics, type AnalyticsRangeDays } from '../../../modules/dashboard/analytics.js';
import { getDashboardSummary } from '../../../modules/dashboard/service.js';
import { requirePrincipal } from '../../authentication.js';

export async function registerAdminDashboardRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/dashboard/summary', { schema: { tags: ['admin-dashboard'] } }, async request => ({
    code: 0, data: await getDashboardSummary(pool, requirePrincipal(request, 'admin').permissions),
  }));

  app.get('/dashboard/analytics', { schema: { tags: ['admin-dashboard'], querystring: {
    type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: [...analyticsRangeDays] } },
  } } }, async request => ({
    code: 0, data: await getDashboardAnalytics(pool, requirePrincipal(request, 'admin').permissions,
      (request.query as { days?: AnalyticsRangeDays }).days ?? 30),
  }));
}
