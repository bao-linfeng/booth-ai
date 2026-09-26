import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getCatalogOptions, updateCatalogOptionsByType, type CatalogOptionInput } from './service.js';

interface CatalogOptionsQuery { types?: string | string[]; }
interface TypeParams { type: string; }
interface ReplaceBody { options: CatalogOptionInput[]; }

const optionSchema = {
  type: 'object', required: ['key', 'label'], additionalProperties: false,
  properties: {
    key: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 },
    sortOrder: { type: 'integer' }, enabled: { type: 'boolean' },
  },
};

export async function registerAdminCatalogOptionsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  // TODO(P1): enforce admin session authentication before allowing dictionary changes.
  app.get('/catalog-options', {
    schema: { tags: ['admin-catalog-options'], querystring: { type: 'object', additionalProperties: false, properties: { types: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'array', items: { type: 'string', minLength: 1 } }] } } } },
  }, async request => {
    const types = (request.query as CatalogOptionsQuery).types;
    return { code: 0, data: await getCatalogOptions(pool, types === undefined ? undefined : Array.isArray(types) ? types : types.split(',').filter(Boolean)) };
  });
  app.put('/catalog-options/:type', {
    schema: {
      tags: ['admin-catalog-options'], params: { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { type: 'string', minLength: 1 } } },
      body: { type: 'object', required: ['options'], additionalProperties: false, properties: { options: { type: 'array', items: optionSchema } } },
    },
  }, async request => {
    const { type } = request.params as TypeParams;
    const { options } = request.body as ReplaceBody;
    return { code: 0, data: await updateCatalogOptionsByType(pool, type, options) };
  });
}
