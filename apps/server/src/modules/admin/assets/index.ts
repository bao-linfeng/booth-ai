import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createStorage } from '../../../infra/storage.js';
import { addAssetVersion, createAsset, deleteAsset, getAsset, getAssetVersion, listAssets, listSchemeAssets, updateAsset, type AssetType, type ListAssetsOptions, type UpdateAssetInput } from './service.js';

interface CodeParams { code: string; }
interface AssetParams extends CodeParams { assetId: string; }
interface AssetsQuery extends Partial<ListAssetsOptions> {}
interface SchemeAssetsQuery { type?: AssetType; }
interface DownloadQuery { assetVersionId?: string; disposition?: 'attachment' | 'preview'; }
interface UpdateBody extends UpdateAssetInput { expectedRevision: number; }
interface DeleteBody { expectedRevision: number; }

const assetTypes = ['model', 'checklist', 'rendering', 'mask', 'drawing', 'artwork'];
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

function parseOptionalInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/.test(value)) throw requestError(`${field} must be an integer`, 400);
  return Number(value);
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined || value === '') return undefined;
  try {
    const metadata: unknown = JSON.parse(value);
    if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Invalid metadata');
    return metadata as Record<string, unknown>;
  } catch {
    throw requestError('Metadata must be a JSON object', 400);
  }
}

export async function registerAdminAssetsRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>): Promise<void> {
  // TODO(P1): enforce admin session authentication and pass the authenticated admin id.
  const adminId: string | null = null;
  app.get('/assets', {
    schema: { tags: ['admin-assets'], querystring: { type: 'object', additionalProperties: false, properties: {
      type: assetTypeSchema, schemeCode: { type: 'string', minLength: 1 }, schemeName: { type: 'string', minLength: 1 },
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async request => {
    const query = request.query as AssetsQuery;
    const options: ListAssetsOptions = {
      page: query.page ?? 1, pageSize: query.pageSize ?? 20,
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
    return { code: 0, data: await listSchemeAssets(pool, decodedCode(request.params as CodeParams), query.type) };
  });

  app.post('/schemes/:code/assets', {
    schema: { tags: ['admin-assets'], params: codeParamsSchema },
  }, async request => {
    let fileBuffer: Buffer | null = null;
    let originalFilename = '';
    let mimeType = 'application/octet-stream';
    const fields: Record<string, string> = {};
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileBuffer !== null) throw requestError('Only one file is allowed', 400);
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
        originalFilename = part.filename ?? 'file';
        mimeType = part.mimetype;
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }
    if (!fileBuffer) throw requestError('File is required', 400);
    const schemeCode = decodedCode(request.params as CodeParams);
    const type = fields.type as AssetType | undefined;
    const name = fields.name?.trim();
    if (!type || !assetTypes.includes(type)) throw requestError('Valid asset type is required', 400);
    if (!name) throw requestError('Asset name is required', 400);
    const sortOrder = parseOptionalInteger(fields.sortOrder, 'sortOrder');
    const relatedAssetId = fields.relatedAssetId === undefined || fields.relatedAssetId === '' ? null : fields.relatedAssetId;
    const metadata = parseMetadata(fields.metadata);
    const objectKey = `schemes/${schemeCode}/${type}/${randomUUID()}_${originalFilename}`;
    await storage.putBuffer(objectKey, fileBuffer, mimeType);
    const asset = await createAsset(pool, adminId, { schemeCode, type, name, ...(sortOrder === undefined ? {} : { sortOrder }), relatedAssetId, ...(metadata === undefined ? {} : { metadata }) });
    await addAssetVersion(pool, adminId, schemeCode, asset.id, {
      objectKey, originalFilename, mimeType, byteSize: fileBuffer.byteLength,
      checksum: createHash('sha256').update(fileBuffer).digest('hex'),
    }, 1);
    return { code: 0, data: await getAsset(pool, schemeCode, asset.id) };
  });

  app.patch('/schemes/:code/assets/:assetId', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema, body: { type: 'object', required: ['expectedRevision'], additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 500 }, sortOrder: { type: 'integer' }, relatedAssetId: { type: ['string', 'null'], format: 'uuid' },
      metadata: { type: 'object', additionalProperties: true }, expectedRevision: { type: 'integer', minimum: 1 },
    } } },
  }, async request => {
    const { expectedRevision, ...input } = request.body as UpdateBody;
    const params = request.params as AssetParams;
    return { code: 0, data: await updateAsset(pool, adminId, decodedCode(params), params.assetId, input, expectedRevision) };
  });

  app.delete('/schemes/:code/assets/:assetId', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema, body: { type: 'object', required: ['expectedRevision'], additionalProperties: false, properties: { expectedRevision: { type: 'integer', minimum: 1 } } } },
  }, async request => {
    const params = request.params as AssetParams;
    const { expectedRevision } = request.body as DeleteBody;
    return { code: 0, data: { revision: await deleteAsset(pool, adminId, decodedCode(params), params.assetId, expectedRevision) } };
  });

  app.get('/schemes/:code/assets/:assetId/download', {
    schema: { tags: ['admin-assets'], params: assetParamsSchema, querystring: { type: 'object', additionalProperties: false, properties: {
      assetVersionId: { type: 'string', format: 'uuid' }, disposition: { type: 'string', enum: ['attachment', 'preview'] },
    } } },
  }, async request => {
    const params = request.params as AssetParams;
    const asset = await getAsset(pool, decodedCode(params), params.assetId);
    const query = request.query as DownloadQuery;
    const version = query.assetVersionId ? await getAssetVersion(pool, asset.id, query.assetVersionId) : asset.currentVersion;
    if (!version) throw requestError('Asset has no uploaded version', 404);
    const expiresIn = 300;
    const url = query.disposition === 'preview'
      ? await storage.signDownload(version.objectKey, expiresIn)
      : await storage.signDownloadWithName(version.objectKey, version.originalFilename, expiresIn);
    return { code: 0, data: { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } };
  });
}
