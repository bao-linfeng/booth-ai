import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import sharp from 'sharp';
import type { createStorage } from '../../infra/storage.js';
import { isRenderingAspect } from './image-spec.js';
import { validateAssetMetadata } from './metadata.js';
import { getAsset } from './queries.js';
import { addAssetVersion, createAssetWithVersion } from './service.js';
import type { AssetType, AssetVersion, CreateAssetInput, SchemeAsset, UploadVersionInput } from './types.js';

type UploadStorage = Pick<ReturnType<typeof createStorage>, 'putBuffer' | 'deleteObject'>;

export interface AssetUploadFile {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
}

async function imageDimensions(file: AssetUploadFile): Promise<{ widthPx: number; heightPx: number } | null> {
  const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
  const format = formats[file.mimeType];
  if (!format) return null;
  try {
    const metadata = await sharp(file.buffer).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) return null;
    return { widthPx: metadata.width, heightPx: metadata.height };
  } catch {
    return null;
  }
}

async function storeAssetUpload<T>(
  storage: UploadStorage,
  schemeCode: string,
  type: AssetType,
  file: AssetUploadFile,
  save: (version: UploadVersionInput) => Promise<T>,
): Promise<T> {
  if (!file.buffer.length) throw Object.assign(new Error('File is required'), { statusCode: 400 });
  const dimensions = await imageDimensions(file);
  if ((type === 'rendering' || type === 'mask') && !dimensions) {
    throw Object.assign(new Error('Unsupported or invalid image'), { statusCode: 400, reason: 'IMAGE_INVALID' });
  }
  if (type === 'rendering' && dimensions && !isRenderingAspect(dimensions.widthPx, dimensions.heightPx)) {
    throw Object.assign(new Error('Rendering must be exactly 16:9'), { statusCode: 400, reason: 'RENDERING_ASPECT_INVALID' });
  }
  const objectKey = `schemes/${schemeCode}/${type}/${randomUUID()}_${file.originalFilename}`;
  const version: UploadVersionInput = {
    objectKey,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    byteSize: file.buffer.byteLength,
    checksum: createHash('sha256').update(file.buffer).digest('hex'),
    ...(dimensions ?? {}),
  };
  await storage.putBuffer(objectKey, file.buffer, file.mimeType);
  try {
    return await save(version);
  } catch (error) {
    await storage.deleteObject(objectKey).catch(() => {});
    throw error;
  }
}

export async function uploadAsset(pool: pg.Pool, storage: UploadStorage, adminId: string | null, input: CreateAssetInput, file: AssetUploadFile): Promise<SchemeAsset> {
  if (input.type === 'mask' && !input.relatedAssetId) {
    throw Object.assign(new Error('relatedAssetId is required for mask assets'), { statusCode: 400 });
  }
  validateAssetMetadata(input.type, input.metadata);
  return storeAssetUpload(storage, input.schemeCode, input.type, file,
    version => createAssetWithVersion(pool, adminId, input, version));
}

export async function uploadAssetVersion(pool: pg.Pool, storage: UploadStorage, adminId: string | null, schemeCode: string, assetId: string, file: AssetUploadFile, expectedRevision: number): Promise<AssetVersion> {
  const asset = await getAsset(pool, schemeCode, assetId);
  return storeAssetUpload(storage, schemeCode, asset.type, file,
    version => addAssetVersion(pool, adminId, schemeCode, assetId, version, expectedRevision));
}
