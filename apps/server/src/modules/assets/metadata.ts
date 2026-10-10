import type { AssetType } from './types.js';

function requestError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function validateAssetMetadata(type: AssetType, metadata: Record<string, unknown> | undefined): void {
  if (type !== 'drawing' && type !== 'artwork') return;
  if (type === 'artwork' && (!metadata || typeof metadata.artworkKey !== 'string' || metadata.artworkKey.trim() === '')) {
    throw requestError('artwork metadata.artworkKey is required');
  }
  if (!metadata) return;
  if (type === 'drawing') {
    if (
      Object.hasOwn(metadata, 'viewCodes') &&
      (!Array.isArray(metadata.viewCodes) || !metadata.viewCodes.every(value => typeof value === 'string'))
    ) {
      throw requestError('drawing metadata.viewCodes must be a string array');
    }
    for (const field of ['purpose', 'applicability', 'exportSpecVersion'] as const) {
      if (Object.hasOwn(metadata, field) && typeof metadata[field] !== 'string')
        throw requestError(`drawing metadata.${field} must be a string`);
    }
    if (
      Object.hasOwn(metadata, 'modelAssetVersionId') &&
      (typeof metadata.modelAssetVersionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadata.modelAssetVersionId))
    ) {
      throw requestError('drawing metadata.modelAssetVersionId must be a UUID');
    }
    return;
  }
  for (const field of ['wallPosition', 'dimensionEvidence'] as const) {
    if (Object.hasOwn(metadata, field) && typeof metadata[field] !== 'string')
      throw requestError(`artwork metadata.${field} must be a string`);
  }
  for (const field of ['physicalWidth', 'physicalHeight'] as const) {
    if (
      Object.hasOwn(metadata, field) &&
      (typeof metadata[field] !== 'number' || !Number.isFinite(metadata[field]) || metadata[field] <= 0)
    ) {
      throw requestError(`artwork metadata.${field} must be a positive number`);
    }
  }
  if (
    Object.hasOwn(metadata, 'dimensionUnit') &&
    (typeof metadata.dimensionUnit !== 'string' || !['mm', 'm', 'cm'].includes(metadata.dimensionUnit))
  ) {
    throw requestError('artwork metadata.dimensionUnit must be mm, m, or cm');
  }
}
