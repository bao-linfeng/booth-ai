import type { FastifyRequest } from 'fastify';
import type { CreateAssetInput } from '../../../modules/assets/types.js';
import type { AssetUploadFile } from '../../../modules/assets/upload.js';
import { readUploadedFile } from '../../uploads.js';

export const assetTypes = ['model', 'checklist', 'rendering', 'mask', 'drawing', 'artwork'] as const;

function requestError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function parseOptionalInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/.test(value)) throw requestError(`${field} must be an integer`);
  return Number(value);
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined || value === '') return undefined;
  try {
    const metadata: unknown = JSON.parse(value);
    if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Invalid metadata');
    return metadata as Record<string, unknown>;
  } catch {
    throw requestError('Metadata must be a JSON object');
  }
}

export async function readAssetMultipart(request: FastifyRequest): Promise<{ file: AssetUploadFile; fields: Record<string, string> }> {
  let file: AssetUploadFile | undefined;
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (file) throw requestError('Only one file is allowed');
      file = { buffer: await readUploadedFile(part), originalFilename: part.filename ?? 'file', mimeType: part.mimetype };
    } else {
      fields[part.fieldname] = part.value as string;
    }
  }
  if (!file?.buffer.length) throw requestError('File is required');
  return { file, fields };
}

export function parseCreateAssetFields(schemeCode: string, fields: Record<string, string>): CreateAssetInput {
  const type = assetTypes.find(type => type === fields.type);
  const name = fields.name?.trim();
  if (!type) throw requestError('Valid asset type is required');
  if (!name) throw requestError('Asset name is required');
  const sortOrder = parseOptionalInteger(fields.sortOrder, 'sortOrder');
  const relatedAssetId = fields.relatedAssetId === undefined || fields.relatedAssetId === '' ? null : fields.relatedAssetId;
  if (relatedAssetId !== null && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(relatedAssetId)) {
    throw requestError('relatedAssetId must be a valid UUID');
  }
  const metadata = parseMetadata(fields.metadata);
  return {
    schemeCode, type, name, relatedAssetId,
    ...(sortOrder === undefined ? {} : { sortOrder }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}
