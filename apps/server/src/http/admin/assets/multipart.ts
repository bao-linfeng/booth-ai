import type { FastifyRequest } from 'fastify';
import type { CreateAssetInput } from '../../../modules/assets/types.js';
import type { AssetUploadFile } from '../../../modules/assets/upload.js';
import { readUploadedFile } from '../../uploads.js';

export const assetTypes = ['model', 'checklist', 'rendering', 'mask', 'drawing', 'artwork'] as const;

// message 只进日志，前端按 reason 提示；字段错误在 details.field 中标出字段名
function requestError(message: string, reason: string, details?: { field: string }): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400, reason }, details ? { details } : {});
}

export function fieldError(message: string, field: string): Error & { statusCode: number } {
  return requestError(message, 'ASSET_FIELD_INVALID', { field });
}

export function parseOptionalInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/.test(value)) throw fieldError(`${field} must be an integer`, field);
  return Number(value);
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined || value === '') return undefined;
  try {
    const metadata: unknown = JSON.parse(value);
    if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Invalid metadata');
    return metadata as Record<string, unknown>;
  } catch {
    throw requestError('Metadata must be a JSON object', 'ASSET_METADATA_INVALID');
  }
}

export async function readAssetMultipart(request: FastifyRequest): Promise<{ file: AssetUploadFile; fields: Record<string, string> }> {
  let file: AssetUploadFile | undefined;
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (file) throw requestError('Only one file is allowed', 'TOO_MANY_FILES');
      file = { buffer: await readUploadedFile(part), originalFilename: part.filename ?? 'file', mimeType: part.mimetype };
    } else {
      fields[part.fieldname] = part.value as string;
    }
  }
  if (!file?.buffer.length) throw requestError('File is required', 'FILE_REQUIRED');
  return { file, fields };
}

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** 可选的上传幂等键（UUID）：同一上传操作重试时沿用，用户重新发起上传时更换。 */
export function parseIdempotencyKey(fields: Record<string, string>): string | undefined {
  const key = fields.idempotencyKey;
  if (key === undefined || key === '') return undefined;
  if (!uuidPattern.test(key)) throw fieldError('idempotencyKey must be a valid UUID', 'idempotencyKey');
  return key;
}

export function parseCreateAssetFields(schemeCode: string, fields: Record<string, string>): CreateAssetInput {
  const type = assetTypes.find(type => type === fields.type);
  const name = fields.name?.trim();
  if (!type) throw fieldError('Valid asset type is required', 'type');
  if (!name) throw fieldError('Asset name is required', 'name');
  const sortOrder = parseOptionalInteger(fields.sortOrder, 'sortOrder');
  const relatedAssetId = fields.relatedAssetId === undefined || fields.relatedAssetId === '' ? null : fields.relatedAssetId;
  if (relatedAssetId !== null && !uuidPattern.test(relatedAssetId)) {
    throw fieldError('relatedAssetId must be a valid UUID', 'relatedAssetId');
  }
  const metadata = parseMetadata(fields.metadata);
  return {
    schemeCode,
    type,
    name,
    relatedAssetId,
    ...(sortOrder === undefined ? {} : { sortOrder }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}
