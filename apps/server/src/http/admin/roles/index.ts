import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { decryptJwt } from '../../../infra/session.js';
import { accessSummary, permissionCatalog } from '../../../modules/identity/permissions.js';
import { getAdminRole, listAdminRoles, updateRolePermissions } from '../../../modules/identity/roles.js';
import { requirePrincipal } from '../../authentication.js';
import { successResponse } from '../../schemas.js';

const params = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
} as const;
const strings = { type: 'array', items: { type: 'string' } } as const;

const accessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['permissions', 'routeNames', 'homePath'],
  properties: { permissions: strings, routeNames: strings, homePath: { type: 'string' } },
} as const;
const permissionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'label', 'group', 'groupKey', 'routes', 'kind', 'requires'],
  properties: {
    code: { type: 'string' },
    label: { type: 'string' },
    group: { type: 'string' },
    groupKey: { type: 'string' },
    routes: strings,
    kind: { type: 'string', enum: ['route', 'action'] },
    requires: strings,
  },
} as const;
const roleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'permissionCodes', 'revision'],
  properties: { id: { type: 'integer' }, name: { type: 'string' }, permissionCodes: strings, revision: { type: 'integer' } },
} as const;

export async function registerAdminRoleRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get('/access', { config: { permissions: [] }, schema: { response: { 200: successResponse(accessSchema) } } }, async request => ({
    code: 0 as const,
    data: accessSummary(requirePrincipal(request, 'admin').permissions),
  }));
  routes.get(
    '/permissions',
    { config: { permissions: ['roles.read'] }, schema: { response: { 200: successResponse({ type: 'array', items: permissionSchema }) } } },
    async () => ({ code: 0, data: permissionCatalog }) as const,
  );
  routes.get(
    '/roles',
    { config: { permissions: ['roles.read'] }, schema: { response: { 200: successResponse({ type: 'array', items: roleSchema }) } } },
    async request => {
      const { session } = requirePrincipal(request, 'admin');
      const jwt = decryptJwt(session.externalJwtCiphertext, config.sessionSecret);
      return { code: 0, data: await listAdminRoles(config, pool, jwt) } as const;
    },
  );
  routes.get(
    '/roles/:id',
    { config: { permissions: ['roles.read'] }, schema: { params, response: { 200: successResponse(roleSchema) } } },
    async request => ({ code: 0, data: await getAdminRole(pool, request.params.id) }) as const,
  );
  routes.put(
    '/roles/:id/permissions',
    {
      config: { permissions: ['roles.write'] },
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['permissionCodes', 'expectedRevision'],
          properties: {
            permissionCodes: {
              type: 'array',
              maxItems: permissionCatalog.length,
              uniqueItems: true,
              items: { type: 'string', enum: permissionCatalog.map(item => item.code) },
            },
            expectedRevision: { type: 'integer', minimum: 0 },
          },
        },
        response: { 200: successResponse(roleSchema) },
      },
    },
    async request =>
      ({
        code: 0,
        data: await updateRolePermissions(
          pool,
          request.params.id,
          request.body.permissionCodes,
          request.body.expectedRevision,
          requirePrincipal(request, 'admin').localId,
        ),
      }) as const,
  );
}
