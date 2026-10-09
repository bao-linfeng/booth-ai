import type {
  ImportDictionaryField,
  ImportPreviewRow,
  ImportPreviewRowData,
} from '#/api/core/schemes';

const dictionaryFields: [ImportDictionaryField, string][] = [
  ['productSystemId', '产品体系'],
  ['styleId', '风格'],
  ['industryIds', '适用行业'],
  ['budgetTierId', '预算档位'],
  ['zoneIds', '功能分区'],
  ['featureIds', '关键特征'],
];

function meters(mm: null | number): null | string {
  return mm === null ? null : String(mm / 1000);
}

/** 长 × 宽 × 高（米）与面积；未填写的维度显示为 ?，全部缺失时返回 —。 */
export function formatImportSize(data?: ImportPreviewRowData): string {
  if (!data) return '—';
  const dimensions = [data.lengthMm, data.widthMm, data.heightMm].map((mm) =>
    meters(mm),
  );
  const area = data.areaM2 === null ? '' : `，${data.areaM2} ㎡`;
  if (dimensions.every((value) => value === null) && !area) return '—';
  return `${dimensions.map((value) => value ?? '?').join(' × ')} m${area}`;
}

export function formatOpeningCount(count: null | number | undefined): string {
  return count === null || count === undefined ? '—' : `${count} 面`;
}

/** 按模板列顺序列出已映射的字典字段及其标签，未填写的字段不列出。 */
export function importDictionaryEntries(
  row: Pick<ImportPreviewRow, 'dictionaryLabels'>,
): { label: string; values: string[] }[] {
  return dictionaryFields.flatMap(([field, label]) => {
    const values = row.dictionaryLabels?.[field] ?? [];
    return values.length > 0 ? [{ label, values }] : [];
  });
}

/** 距预览失效的剩余毫秒数，已过期时为 0。 */
export function previewRemainingMs(expiresAt: string, now: number): number {
  return Math.max(new Date(expiresAt).getTime() - now, 0);
}

export function formatPreviewRemaining(ms: number): string {
  if (ms <= 0) return '预览已过期';
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? '剩余不足 1 分钟' : `剩余 ${minutes} 分钟`;
}
