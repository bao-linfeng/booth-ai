import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { analyticsRangeDays, getDashboardAnalytics } from '../../../modules/dashboard/analytics.js';
import { getDashboardWorkspace } from '../../../modules/dashboard/workspace.js';
import { adminUserId, requirePrincipal } from '../../authentication.js';
import { successResponse } from '../../schemas.js';

const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const integers = { type: 'array', items: integer } as const;
const projectStatus = { type: 'string', enum: ['pending', 'following', 'quoted', 'won', 'lost', 'closed'] } as const;
const nullableProjectStatus = {
  type: ['string', 'null'],
  enum: ['pending', 'following', 'quoted', 'won', 'lost', 'closed', null],
} as const;
const distribution = <const K>(key: K) =>
  ({
    type: 'array',
    items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key, value: integer } },
  }) as const;
const nullable = <const T>(schema: T) => ({ anyOf: [schema, { type: 'null' }] }) as const;
const metricKey = { type: 'string', enum: ['users', 'searches', 'generations', 'projects'] } as const;

const workspaceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['projects', 'notifications', 'generatedAt', 'timeZone'],
  properties: {
    projects: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['active', 'pending', 'todayFollowUps', 'overdueFollowUps', 'taskTotal', 'tasks', 'activities'],
      properties: {
        active: integer,
        pending: integer,
        todayFollowUps: integer,
        overdueFollowUps: integer,
        taskTotal: integer,
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'projectId',
              'projectNo',
              'company',
              'contactName',
              'exhibitionName',
              'status',
              'reason',
              'nextFollowUpAt',
              'createdAt',
            ],
            properties: {
              projectId: string,
              projectNo: string,
              company: nullableString,
              contactName: nullableString,
              exhibitionName: nullableString,
              status: projectStatus,
              reason: { type: 'string', enum: ['overdue', 'today', 'pending'] },
              nextFollowUpAt: nullableString,
              createdAt: string,
            },
          },
        },
        activities: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'kind',
              'projectId',
              'projectNo',
              'actorName',
              'byMe',
              'fromStatus',
              'toStatus',
              'schemeCode',
              'quotationRevision',
              'createdAt',
            ],
            properties: {
              id: string,
              kind: string,
              projectId: string,
              projectNo: string,
              actorName: nullableString,
              byMe: { type: 'boolean' },
              fromStatus: nullableProjectStatus,
              toStatus: nullableProjectStatus,
              schemeCode: nullableString,
              quotationRevision: { type: ['integer', 'null'] },
              createdAt: string,
            },
          },
        },
      },
    }),
    notifications: nullable({ type: 'object', additionalProperties: false, required: ['unread'], properties: { unread: integer } }),
    generatedAt: string,
    timeZone: string,
  },
} as const;

const analyticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'generatedAt',
    'timeZone',
    'days',
    'dates',
    'months',
    'overview',
    'trend',
    'monthlyProjects',
    'funnel',
    'projectStatuses',
    'generationStatuses',
  ],
  properties: {
    generatedAt: string,
    timeZone: string,
    days: { type: 'integer', enum: analyticsRangeDays },
    dates: { type: 'array', items: string },
    months: { type: 'array', items: string },
    overview: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'total'],
        properties: { key: metricKey, value: integer, total: integer },
      },
    },
    trend: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'data'], properties: { key: metricKey, data: integers } },
    },
    monthlyProjects: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['created', 'won'],
      properties: { created: integers, won: integers },
    }),
    funnel: distribution({ type: 'string', enum: ['visitors', 'matchedVisitors', 'generationUsers', 'inquiryCustomers', 'wonCustomers'] }),
    projectStatuses: nullable(distribution(projectStatus)),
    generationStatuses: nullable(distribution({ type: 'string', enum: ['succeeded', 'partially_succeeded', 'failed', 'processing'] })),
  },
} as const;

export async function registerAdminDashboardRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/dashboard/workspace',
    {
      config: { permissions: ['workspace.read'] },
      schema: { tags: ['admin-dashboard'], response: { 200: successResponse(workspaceSchema) } },
    },
    async request =>
      ({
        code: 0,
        data: await getDashboardWorkspace(pool, adminUserId(request), requirePrincipal(request, 'admin').permissions),
      }) as const,
  );

  routes.get(
    '/dashboard/analytics',
    {
      config: { permissions: ['dashboard.read'] },
      schema: {
        tags: ['admin-dashboard'],
        querystring: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: analyticsRangeDays } } },
        response: { 200: successResponse(analyticsSchema) },
      },
    },
    async request =>
      ({
        code: 0,
        data: await getDashboardAnalytics(pool, requirePrincipal(request, 'admin').permissions, request.query.days ?? 30),
      }) as const,
  );
}
