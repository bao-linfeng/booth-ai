import type { AssetType } from './types.js';

/** 违反的规则，前端据此与字段名组合提示 */
type MetadataRule = 'required' | 'string' | 'string_array' | 'uuid' | 'positive_number' | 'unit';

function metadataError(message: string, field: string, rule: MetadataRule): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400, reason: 'ASSET_METADATA_INVALID', details: { field, rule } });
}

export function validateAssetMetadata(type: AssetType, metadata: Record<string, unknown> | undefined): void {
  if (type !== 'drawing' && type !== 'artwork') return;
  if (type === 'artwork' && (!metadata || typeof metadata.artworkKey !== 'string' || metadata.artworkKey.trim() === '')) {
    throw metadataError('artwork metadata.artworkKey is required', 'artworkKey', 'required');
  }
  if (!metadata) return;
  if (type === 'drawing') {
    if (
      Object.hasOwn(metadata, 'viewCodes') &&
      (!Array.isArray(metadata.viewCodes) || !metadata.viewCodes.every(value => typeof value === 'string'))
    ) {
      throw metadataError('drawing metadata.viewCodes must be a string array', 'viewCodes', 'string_array');
    }
    for (const field of ['purpose', 'applicability', 'exportSpecVersion'] as const) {
      if (Object.hasOwn(metadata, field) && typeof metadata[field] !== 'string')
        throw metadataError(`drawing metadata.${field} must be a string`, field, 'string');
    }
    if (
      Object.hasOwn(metadata, 'modelAssetVersionId') &&
      (typeof metadata.modelAssetVersionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadata.modelAssetVersionId))
    ) {
      throw metadataError('drawing metadata.modelAssetVersionId must be a UUID', 'modelAssetVersionId', 'uuid');
    }
    return;
  }
  for (const field of ['wallPosition', 'dimensionEvidence'] as const) {
    if (Object.hasOwn(metadata, field) && typeof metadata[field] !== 'string')
      throw metadataError(`artwork metadata.${field} must be a string`, field, 'string');
  }
  for (const field of ['physicalWidth', 'physicalHeight'] as const) {
    if (
      Object.hasOwn(metadata, field) &&
      (typeof metadata[field] !== 'number' || !Number.isFinite(metadata[field]) || metadata[field] <= 0)
    ) {
      throw metadataError(`artwork metadata.${field} must be a positive number`, field, 'positive_number');
    }
  }
  if (
    Object.hasOwn(metadata, 'dimensionUnit') &&
    (typeof metadata.dimensionUnit !== 'string' || !['mm', 'm', 'cm'].includes(metadata.dimensionUnit))
  ) {
    throw metadataError('artwork metadata.dimensionUnit must be mm, m, or cm', 'dimensionUnit', 'unit');
  }
}
