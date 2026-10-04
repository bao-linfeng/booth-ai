import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { adminUserId, requirePrincipal } from '../../authentication.js';
import { requireAdminPermission } from '../authorization.js';
import { assetPermissionCode } from '../../../modules/identity/permissions.js';
import { getAsset, getAssetVersion, listAssets, listSchemeAssets } from '../../../modules/assets/queries.js';
import { deleteAsset, updateAsset } from '../../../modules/assets/service.js';
import type { AssetType, ListAssetsOptions, UpdateAssetInput } from '../../../modules/assets/types.js';
import { uploadAsset, uploadAssetVersion } from '../../../modules/assets/upload.js';
import { assetTypes, parseCreateAssetFields, parseOptionalInteger, readAssetMultipart } from './multipart.js';

interface CodeParams { code: string; }
interface AssetParams extends CodeParams { assetId: string; }
interface AssetsQuery extends Partial<ListAssetsOptions> {}
interface SchemeAssetsQuery { type?: AssetType; }
interface DownloadQuery { assetVersionId?: string; disposition?: 'attachment' | 'preview'; }
interface UpdateBody extends UpdateAssetInput { expectedRevision: number; }
interface DeleteBody { expectedRevision: number; }

const assetTypeSchema = { type: 'string', enum: assetTypes };
const codeParamsSchema = { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', minLength: 1 } } };
const assetParamsSchema = { type: 'object', required: ['code', 'assetId'], additionalProperties: false, properties: { code: { type: 'string', minLength: 1 }, assetId: { type: 'string', format: 'uuid' } } };

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function decodedCode(params: CodeParams): string {
  try {
    return decodeURIComponent(params.code);
  } catch {
    throw requestError('Invalid scheme code', 400);
  }
}

export async function registerAdminAssetsRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>, redis: Redis): Promise<void> {
  app.get('/assets', {
    schema: { tags: ['admin-assets'], querystring: { type: 'object', additionalProperties: false, properties: {
      type: assetTypeSchema, schemeCode: { type: 'string', minLength: 1 }, schemeName: { type: 'string', minLength: 1 },
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async request => {
    const query = request.query as AssetsQuery;
    const allowedTypes = assetTypes.filter(type => requirePrincipal(request, 'admin').permissions.includes(assetPermissionCode(type, 'read')));
    if (query.type) requireAdminPermission(request, assetPermissionCode(query.type, 'read'));
    const options: ListAssetsOptions = {
      page: query.page ?? 1, pageSize: query.pageSize ?? 20,
      allowedTypes,
      ...(query.type ? { type: query.type } : {}),
      ...(query.schemeCode ? { schemeCode: query.schemeCode.trim() } : {}),
      ...(query.schemeName ? { schemeName: query.schemeName.trim() } : {}),
    };
    return { code: 0, data: await listAssets(pool, options) };
  });

  app.get('/schemes/:code/assets', {
    schema: { tags: ['admin-assets'], params: codeParamsSchema, querystring: { type: 'object', additionalProperties: false, properties: { type: assetTypeSchema } } },
  }, async request => {
    const query = request.query as SchemeAssetsQuery;
    if (query.type) requireAdminPermission(request, assetPermissionCode(query.type, 'read'));
    const assets = await listSchemeAssets(pool, decodedCode(request.params as CodeParams), query.type);
    const permissions = requirePrincipal(request, 'admin').permissions;
    return { code: 0, data: assets.filter(asset => permissions.includes(assetPermissionCode(asset.type, 'read'))) };
  });

  app.post('/schemes/:code/assets', {
    schema: { tags: ['admin-assets'], params: codeParamsSchema },
  }, async request => {
    const { file, fields } = await readAssetMultipart(request);
    const input = parseCreateAssetFields(decodedCode(request.params as CodeParams), fields);
    requireAdminPermission(request, assetPermissionCode(input.type, 'upload'));
    return { code: 0, data: await uploadAsset(pool, storage, adminUserId(request), input, file) };
  });

  app.patch('/schemes/:code/assets/:assetId', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema, body: { type: 'object', required: ['expectedRevision'], additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 500 }, sortOrder: { type: 'integer' }, relatedAssetId: { type: ['string', 'null'], format: 'uuid' },
      metadata: { type: 'object', additionalProperties: true }, expectedRevision: { type: 'integer', minimum: 1 },
    } } },
  }, async request => {
    const { expectedRevision, ...input } = request.body as UpdateBody;
    const params = request.params as AssetParams;
    const asset = await getAsset(pool, decodedCode(params), params.assetId);
    requireAdminPermission(request, assetPermissionCode(asset.type, 'update'));
    return { code: 0, data: await updateAsset(pool, adminUserId(request), decodedCode(params), params.assetId, input, expectedRevision) };
  });

  app.post('/schemes/:code/assets/:assetId/versions', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema },
  }, async request => {
    const params = request.params as AssetParams;
    const schemeCode = decodedCode(params);
    const asset = await getAsset(pool, schemeCode, params.assetId);
    requireAdminPermission(request, assetPermissionCode(asset.type, 'replace'));
    const { file, fields } = await readAssetMultipart(request);
    const expectedRevision = parseOptionalInteger(fields.expectedRevision, 'expectedRevision');
    if (!expectedRevision || expectedRevision < 1) throw requestError('expectedRevision is required', 400);
    return { code: 0, data: await uploadAssetVersion(pool, storage, adminUserId(request), schemeCode, params.assetId, file, expectedRevision) };
  });

  app.delete('/schemes/:code/assets/:assetId', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema, body: { type: 'object', required: ['expectedRevision'], additionalProperties: false, properties: { expectedRevision: { type: 'integer', minimum: 1 } } } },
  }, async request => {
    const params = request.params as AssetParams;
    const { expectedRevision } = request.body as DeleteBody;
    const asset = await getAsset(pool, decodedCode(params), params.assetId);
    requireAdminPermission(request, assetPermissionCode(asset.type, 'delete'));
    return { code: 0, data: { revision: await deleteAsset(pool, adminUserId(request), decodedCode(params), params.assetId, expectedRevision) } };
  });

  app.get('/schemes/:code/assets/:assetId/download', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema, querystring: { type: 'object', additionalProperties: false, properties: {
      assetVersionId: { type: 'string', format: 'uuid' }, disposition: { type: 'string', enum: ['attachment', 'preview'] },
    } } },
  }, async request => {
    const params = request.params as AssetParams;
    const asset = await getAsset(pool, decodedCode(params), params.assetId);
    const query = request.query as DownloadQuery;
    requireAdminPermission(request, assetPermissionCode(asset.type, query.disposition === 'preview' ? 'preview' : 'download'));
    const version = query.assetVersionId ? await getAssetVersion(pool, asset.id, query.assetVersionId) : asset.currentVersion;
    if (!version) throw requestError('Asset has no uploaded version', 404);
    const expiresIn = 300;
    const url = query.disposition === 'preview'
      ? await storage.signDownload(version.objectKey, expiresIn)
      : await storage.signDownloadWithName(version.objectKey, version.originalFilename, expiresIn);
    return { code: 0, data: { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } };
  });
}
