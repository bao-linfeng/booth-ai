import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { decryptJwt } from '../../infra/session.js';
import { accessSummary, permissionCatalog } from '../../modules/identity/permissions.js';
import { getAdminRole, listAdminRoles, updateRolePermissions } from '../../modules/identity/roles.js';
import { requirePrincipal } from '../authentication.js';

const params = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } };

export async function registerAdminRoleRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): Promise<void> {
  app.get('/access', async request => ({ code: 0, data: accessSummary(requirePrincipal(request, 'admin').permissions) }));
  app.get('/permissions', async () => ({ code: 0, data: permissionCatalog }));
  app.get('/roles', async request => {
    const { session } = requirePrincipal(request, 'admin');
    const jwt = decryptJwt(session.externalJwtCiphertext, config.sessionSecret);
    return { code: 0, data: await listAdminRoles(config, pool, jwt) };
  });
  app.get<{ Params: { id: number } }>('/roles/:id', { schema: { params } }, async request => ({
    code: 0, data: await getAdminRole(pool, request.params.id),
  }));
  app.put<{ Params: { id: number }; Body: { permissionCodes: string[]; expectedRevision: number } }>('/roles/:id/permissions', {
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['permissionCodes', 'expectedRevision'], properties: {
      permissionCodes: { type: 'array', maxItems: permissionCatalog.length, uniqueItems: true, items: { type: 'string', enum: permissionCatalog.map(item => item.code) } },
      expectedRevision: { type: 'integer', minimum: 0 },
    } } },
  }, async request => ({ code: 0, data: await updateRolePermissions(pool, request.params.id, request.body.permissionCodes,
    request.body.expectedRevision, requirePrincipal(request, 'admin').localId) }));
}
