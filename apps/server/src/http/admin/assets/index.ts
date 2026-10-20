import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import type { TypeProvider } from '../../type-provider.js';
import { adminUserId, requirePrincipal } from '../../authentication.js';
import { pageSchema, successResponse } from '../../schemas.js';
import { hasAdminPermission, requireAdminPermission } from '../authorization.js';
import { assetPermissionCode } from '../../../modules/identity/permissions.js';
import { getAsset, getAssetVersion, listAssets, listMaskPairingCandidates, listSchemeAssets } from '../../../modules/assets/queries.js';
import { deleteAsset, updateAsset } from '../../../modules/assets/service.js';
import type { ListAssetsOptions, SchemeAsset } from '../../../modules/assets/types.js';
import { loadRenditions, signImage, signImageLinks } from '../../../modules/media/links.js';
import { uploadAsset, uploadAssetVersion } from '../../../modules/assets/upload.js';
import {
  assetTypes,
  fieldError,
  parseCreateAssetFields,
  parseIdempotencyKey,
  parseOptionalInteger,
  readAssetMultipart,
} from './multipart.js';

const tags = ['admin-assets'];
const readPermissions = [
  'assets-renderings.read',
  'assets-masks.read',
  'assets-drawings.read',
  'assets-artworks.read',
  'assets-models.read',
  'assets-checklists.read',
] as const;
const assetTypeSchema = { type: 'string', enum: assetTypes } as const;
const codeParamsSchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
} as const;
const assetParamsSchema = {
  type: 'object',
  required: ['code', 'assetId'],
  additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 }, assetId: { type: 'string', format: 'uuid' } },
} as const;

const string = { type: 'string' } as const;
const integer = { type: 'integer' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;

const assetVersionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'assetId',
    'objectKey',
    'originalFilename',
    'mimeType',
    'byteSize',
    'checksum',
    'widthPx',
    'heightPx',
    'pageCount',
    'createdAt',
  ],
  properties: {
    id: string,
    assetId: string,
    objectKey: string,
    originalFilename: string,
    mimeType: string,
    byteSize: integer,
    checksum: string,
    widthPx: nullableInteger,
    heightPx: nullableInteger,
    pageCount: nullableInteger,
    createdAt: dateTime,
  },
} as const;

const schemeAssetSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'schemeId',
    'schemeCode',
    'schemeName',
    'type',
    'name',
    'sortOrder',
    'relatedAssetId',
    'metadata',
    'isActive',
    'revision',
    'currentVersion',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: string,
    schemeId: string,
    schemeCode: string,
    schemeName: string,
    type: assetTypeSchema,
    name: string,
    sortOrder: integer,
    relatedAssetId: nullableString,
    metadata: { type: 'object', additionalProperties: true, description: '按资产类型校验的扩展信息' },
    isActive: { type: 'boolean' },
    revision: integer,
    currentVersion: { anyOf: [assetVersionSchema, { type: 'null' }] },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
} as const;

// 方案详情的资产汇总直接显示缩略图、点开看预览图；原图仍走下载接口
const schemeAssetWithImageSchema = {
  ...schemeAssetSchema,
  required: [...schemeAssetSchema.required, 'thumbnailUrl', 'previewUrl'],
  properties: { ...schemeAssetSchema.properties, thumbnailUrl: nullableString, previewUrl: nullableString },
} as const;

const maskCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'sortOrder', 'file', 'thumbnailUrl', 'pairedMask'],
  properties: {
    id: string,
    name: string,
    sortOrder: integer,
    file: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['originalFilename', 'widthPx', 'heightPx'],
          properties: { originalFilename: string, widthPx: nullableInteger, heightPx: nullableInteger },
        },
        { type: 'null' },
      ],
    },
    thumbnailUrl: nullableString,
    pairedMask: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'revision'],
          properties: { id: string, name: string, revision: integer },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

/** 能预览或下载该类资产的管理员才签发图片地址；效果图只有预览权限，报馆图、平面素材只有下载权限。 */
function canViewImage(permissions: string[], asset: SchemeAsset): boolean {
  return (
    !!asset.currentVersion?.mimeType.startsWith('image/') &&
    ['preview', 'download'].some(action => hasAdminPermission(permissions, assetPermissionCode(asset.type, action)))
  );
}

function requestError(message: string, statusCode: number, reason?: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode }, reason ? { reason } : {});
}

export async function registerAdminAssetsRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: ReturnType<typeof createStorage>,
): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/assets',
    {
      config: { permissions: [...readPermissions] },
      schema: {
        tags,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: assetTypeSchema,
            schemeCode: { type: 'string', minLength: 1 },
            schemeName: { type: 'string', minLength: 1 },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: { 200: successResponse(pageSchema(schemeAssetSchema)) },
      },
    },
    async request => {
      const query = request.query;
      const allowedTypes = assetTypes.filter(type =>
        requirePrincipal(request, 'admin').permissions.includes(assetPermissionCode(type, 'read')),
      );
      if (query.type) requireAdminPermission(request, assetPermissionCode(query.type, 'read'));
      const options: ListAssetsOptions = {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        allowedTypes,
        ...(query.type ? { type: query.type } : {}),
        ...(query.schemeCode ? { schemeCode: query.schemeCode.trim() } : {}),
        ...(query.schemeName ? { schemeName: query.schemeName.trim() } : {}),
      };
      return { code: 0, data: await listAssets(pool, options) } as const;
    },
  );

  routes.get(
    '/schemes/:code/assets',
    {
      config: { permissions: [...readPermissions] },
      schema: {
        tags,
        params: codeParamsSchema,
        querystring: { type: 'object', additionalProperties: false, properties: { type: assetTypeSchema } },
        response: { 200: successResponse({ type: 'array', items: schemeAssetWithImageSchema }) },
      },
    },
    async request => {
      const query = request.query;
      if (query.type) requireAdminPermission(request, assetPermissionCode(query.type, 'read'));
      const listed = await listSchemeAssets(pool, request.params.code, query.type);
      const permissions = requirePrincipal(request, 'admin').permissions;
      const assets = listed.filter(asset => permissions.includes(assetPermissionCode(asset.type, 'read')));
      const images = assets.filter(asset => canViewImage(permissions, asset));
      const renditions = await loadRenditions(
        pool,
        images.map(asset => asset.currentVersion!.id),
      );
      const links = new Map(
        await Promise.all(
          images.map(async asset => {
            const version = asset.currentVersion!;
            const image = { objectKey: version.objectKey, renditions: renditions.get(version.id) };
            return [asset.id, await signImageLinks(storage, image, 600)] as const;
          }),
        ),
      );
      const data = assets.map(asset => ({ ...asset, ...(links.get(asset.id) ?? { thumbnailUrl: null, previewUrl: null }) }));
      return { code: 0, data } as const;
    },
  );

  routes.get(
    '/schemes/:code/assets/mask-candidates',
    {
      config: { permissions: [...readPermissions] },
      schema: {
        tags,
        summary: '蒙版上传与改配的效果图候选（尺寸、排序、缩略图与占用蒙版）',
        params: codeParamsSchema,
        response: { 200: successResponse({ type: 'array', items: maskCandidateSchema }) },
      },
    },
    async request => {
      const permissions = requirePrincipal(request, 'admin').permissions;
      if (!['upload', 'update'].some(action => hasAdminPermission(permissions, assetPermissionCode('mask', action)))) {
        requireAdminPermission(request, assetPermissionCode('mask', 'upload'));
      }
      // 缩略图仍按效果图预览权限签发，无预览权限时只返回文件信息
      const canPreview = hasAdminPermission(permissions, assetPermissionCode('rendering', 'preview'));
      const candidates = await listMaskPairingCandidates(pool, request.params.code);
      const versionIds = candidates.flatMap(({ rendering }) => (rendering.currentVersion ? [rendering.currentVersion.id] : []));
      const renditions = await loadRenditions(pool, canPreview ? versionIds : []);
      const data = await Promise.all(
        candidates.map(async ({ rendering, pairedMask }) => {
          const version = rendering.currentVersion;
          return {
            id: rendering.id,
            name: rendering.name,
            sortOrder: rendering.sortOrder,
            file: version ? { originalFilename: version.originalFilename, widthPx: version.widthPx, heightPx: version.heightPx } : null,
            thumbnailUrl:
              version && canPreview
                ? await signImage(storage, { objectKey: version.objectKey, renditions: renditions.get(version.id) }, 'thumb', 600)
                : null,
            pairedMask: pairedMask ? { id: pairedMask.id, name: pairedMask.name, revision: pairedMask.revision } : null,
          };
        }),
      );
      return { code: 0, data } as const;
    },
  );

  routes.post(
    '/schemes/:code/assets',
    {
      config: { permissions: [...readPermissions] },
      schema: { tags, params: codeParamsSchema, response: { 200: successResponse(schemeAssetSchema) } },
    },
    async request => {
      const { file, fields } = await readAssetMultipart(request);
      const input = parseCreateAssetFields(request.params.code, fields);
      requireAdminPermission(request, assetPermissionCode(input.type, 'upload'));
      return { code: 0, data: await uploadAsset(pool, storage, adminUserId(request), input, file, parseIdempotencyKey(fields)) } as const;
    },
  );

  routes.patch(
    '/schemes/:code/assets/:assetId',
    {
      config: { permissions: [...readPermissions] },
      schema: {
        tags,
        params: assetParamsSchema,
        body: {
          type: 'object',
          required: ['expectedRevision'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 500 },
            sortOrder: { type: 'integer' },
            relatedAssetId: { type: ['string', 'null'], format: 'uuid' },
            metadata: { type: 'object', additionalProperties: true },
            expectedRevision: { type: 'integer', minimum: 1 },
          },
        },
        response: { 200: successResponse(schemeAssetSchema) },
      },
    },
    async request => {
      const { expectedRevision, ...input } = request.body;
      const params = request.params;
      const asset = await getAsset(pool, params.code, params.assetId);
      requireAdminPermission(request, assetPermissionCode(asset.type, 'update'));
      return {
        code: 0,
        data: await updateAsset(pool, adminUserId(request), params.code, params.assetId, input, expectedRevision),
      } as const;
    },
  );

  routes.post(
    '/schemes/:code/assets/:assetId/versions',
    {
      config: { permissions: [...readPermissions] },
      schema: { tags, params: assetParamsSchema, response: { 200: successResponse(assetVersionSchema) } },
    },
    async request => {
      const params = request.params;
      const schemeCode = params.code;
      const asset = await getAsset(pool, schemeCode, params.assetId);
      requireAdminPermission(request, assetPermissionCode(asset.type, 'replace'));
      const { file, fields } = await readAssetMultipart(request);
      const expectedRevision = parseOptionalInteger(fields.expectedRevision, 'expectedRevision');
      if (!expectedRevision || expectedRevision < 1) throw fieldError('expectedRevision is required', 'expectedRevision');
      return {
        code: 0,
        data: await uploadAssetVersion(pool, storage, adminUserId(request), schemeCode, params.assetId, file, expectedRevision),
      } as const;
    },
  );

  routes.delete(
    '/schemes/:code/assets/:assetId',
    {
      config: { permissions: [...readPermissions] },
      schema: {
        tags,
        params: assetParamsSchema,
        body: {
          type: 'object',
          required: ['expectedRevision'],
          additionalProperties: false,
          properties: {
            expectedRevision: { type: 'integer', minimum: 1 },
            withPairedMasks: { type: 'boolean' },
          },
        },
        response: {
          200: successResponse({ type: 'object', additionalProperties: false, required: ['revision'], properties: { revision: integer } }),
        },
      },
    },
    async request => {
      const params = request.params;
      const { expectedRevision, withPairedMasks } = request.body;
      const asset = await getAsset(pool, params.code, params.assetId);
      requireAdminPermission(request, assetPermissionCode(asset.type, 'delete'));
      if (withPairedMasks && asset.type === 'rendering') requireAdminPermission(request, assetPermissionCode('mask', 'delete'));
      const revision = await deleteAsset(pool, adminUserId(request), params.code, params.assetId, expectedRevision, {
        withPairedMasks: withPairedMasks === true,
      });
      return { code: 0, data: { revision } } as const;
    },
  );

  routes.get(
    '/schemes/:code/assets/:assetId/download',
    {
      config: { permissions: [...readPermissions] },
      schema: {
        tags,
        params: assetParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            assetVersionId: { type: 'string', format: 'uuid' },
            disposition: { type: 'string', enum: ['attachment', 'preview'] },
          },
        },
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['url', 'expiresAt'],
            properties: { url: string, expiresAt: dateTime },
          }),
        },
      },
    },
    async request => {
      const params = request.params;
      const asset = await getAsset(pool, params.code, params.assetId);
      const query = request.query;
      requireAdminPermission(request, assetPermissionCode(asset.type, query.disposition === 'preview' ? 'preview' : 'download'));
      const version = query.assetVersionId ? await getAssetVersion(pool, asset.id, query.assetVersionId) : asset.currentVersion;
      if (!version) throw requestError('Asset has no uploaded version', 404, 'ASSET_FILE_MISSING');
      const expiresIn = 300;
      const url =
        query.disposition === 'preview'
          ? await storage.signDownload(version.objectKey, expiresIn)
          : await storage.signDownloadWithName(version.objectKey, version.originalFilename, expiresIn);
      return { code: 0, data: { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } } as const;
    },
  );
}
