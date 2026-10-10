import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getSearch, listSearchVisitors, listSearches } from '../../../modules/selection/analytics/queries.js';
import { getStatistics } from '../../../modules/selection/analytics/statistics.js';

interface SearchQuery {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  status?: string;
  mode?: string;
  visitorId?: string;
  userId?: string;
  schemeCode?: string;
}

export async function registerAdminSchemeSearchesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/scheme-searches', { config: { permissions: ['searches.read'] }, schema: { tags: ['admin-scheme-searches'], querystring: {
    type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' },
      status: { type: 'string', enum: ['matched', 'no_match', 'needs_clarification'] },
       mode: { type: 'string', enum: ['random', 'filtered'] }, visitorId: { type: 'string', minLength: 1, maxLength: 128 },
       userId: { type: 'string', format: 'uuid' }, schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
    },
  } } }, async request => ({ code: 0, data: await listSearches(pool, {
    page: (request.query as SearchQuery).page ?? 1, pageSize: (request.query as SearchQuery).pageSize ?? 20,
    ...request.query as SearchQuery,
  }) }));

  app.get('/scheme-searches/visitors', { config: { permissions: ['searches.read'] }, schema: { tags: ['admin-scheme-searches'] } }, async () => ({
    code: 0, data: await listSearchVisitors(pool),
  }));

  app.get('/scheme-searches/statistics', { config: { permissions: ['search-analytics.read'] }, schema: { tags: ['admin-scheme-searches'], querystring: {
     type: 'object', additionalProperties: false, properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, granularity: { type: 'string', enum: ['date', 'hour'] } },
   } } }, async request => ({ code: 0, data: await getStatistics(pool, request.query as { from?: string; to?: string; granularity?: 'date' | 'hour' }) }));

  app.get('/scheme-searches/:id', { config: { permissions: ['searches.detail'] }, schema: { tags: ['admin-scheme-searches'], params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } } } }, async request => ({
    code: 0, data: await getSearch(pool, (request.params as { id: string }).id),
  }));
}
