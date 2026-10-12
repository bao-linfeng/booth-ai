import type { SchemeAsset } from '#/api/core/assets';

export type DimensionUnit = 'cm' | 'm' | 'mm';

export const DIMENSION_UNIT_OPTIONS: { label: string; value: DimensionUnit }[] =
  [
    { label: 'mm', value: 'mm' },
    { label: 'cm', value: 'cm' },
    { label: 'm', value: 'm' },
  ];

export const DEFAULT_DIMENSION_UNIT: DimensionUnit = 'mm';

const COMMON_WALL_POSITIONS = ['正面', '背景墙', '左侧墙', '右侧墙', '前台'];

/** 单张平面素材的墙面位置与物理尺寸（表单值，未填为 undefined/null） */
export interface ArtworkFields {
  wallPosition?: string;
  physicalWidth?: null | number;
  physicalHeight?: null | number;
  dimensionUnit: DimensionUnit;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isDimensionUnit(value: unknown): value is DimensionUnit {
  return value === 'mm' || value === 'cm' || value === 'm';
}

/** 从资产 metadata 读出可编辑字段，缺失的单位按默认值 */
export function readArtworkFields(
  metadata: Record<string, unknown>,
): ArtworkFields {
  return {
    wallPosition:
      typeof metadata.wallPosition === 'string'
        ? metadata.wallPosition
        : undefined,
    physicalWidth: positiveNumber(metadata.physicalWidth) ?? null,
    physicalHeight: positiveNumber(metadata.physicalHeight) ?? null,
    dimensionUnit: isDimensionUnit(metadata.dimensionUnit)
      ? metadata.dimensionUnit
      : DEFAULT_DIMENSION_UNIT,
  };
}

/**
 * 把表单字段合并进原 metadata：保留其他键（如 dimensionEvidence），未填的字段删除；
 * 宽高都未填时不写单位。服务端 PATCH 整体替换 metadata，因此编辑时必须传入原值。
 */
export function buildArtworkMetadata(
  fields: ArtworkFields,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const wallPosition = fields.wallPosition?.trim();
  const width = positiveNumber(fields.physicalWidth);
  const height = positiveNumber(fields.physicalHeight);
  const entries: [string, unknown][] = [
    ['wallPosition', wallPosition || undefined],
    ['physicalWidth', width],
    ['physicalHeight', height],
    [
      'dimensionUnit',
      width === undefined && height === undefined
        ? undefined
        : fields.dimensionUnit,
    ],
  ];
  const managed = new Set(entries.map(([key]) => key));
  const metadata: Record<string, unknown> = Object.fromEntries(
    Object.entries(base).filter(([key]) => !managed.has(key)),
  );
  for (const [key, value] of entries) {
    if (value !== undefined) metadata[key] = value;
  }
  return metadata;
}

/** 列表展示用尺寸，如 `3000 × 2500 mm`；宽高都未填时返回 `-` */
export function formatArtworkSize(metadata: Record<string, unknown>): string {
  const width = positiveNumber(metadata.physicalWidth);
  const height = positiveNumber(metadata.physicalHeight);
  if (width === undefined && height === undefined) return '-';
  const unit = isDimensionUnit(metadata.dimensionUnit)
    ? ` ${metadata.dimensionUnit}`
    : '';
  return `${width ?? '-'} × ${height ?? '-'}${unit}`;
}

/** 墙面位置候选：该方案已用过的位置在前，再补常用位置，去重 */
export function wallPositionOptions(
  assets: Pick<SchemeAsset, 'metadata'>[],
): { value: string }[] {
  const used = assets
    .map((asset) => asset.metadata.wallPosition)
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim() !== '',
    )
    .map((value) => value.trim());
  return [...new Set([...used, ...COMMON_WALL_POSITIONS])].map((value) => ({
    value,
  }));
}
