import type {
  ImportChangedField,
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

/** 按模板列顺序列出字典字段及其标签，标出确认导入时将新建的条目；未填写的字段不列出。 */
export function importDictionaryEntries(
  row: Pick<ImportPreviewRow, 'dictionaryLabels' | 'newDictionaryLabels'>,
): { label: string; values: { isNew: boolean; text: string }[] }[] {
  return dictionaryFields.flatMap(([field, label]) => {
    const created = new Set(row.newDictionaryLabels?.[field]);
    const values = (row.dictionaryLabels?.[field] ?? []).map((text) => ({
      isNew: created.has(text),
      text,
    }));
    return values.length > 0 ? [{ label, values }] : [];
  });
}

/**
 * 确认导入时将新建的字典项，按字段汇总并去重（不区分大小写，与服务端匹配规则一致）。
 * 只统计会写入的行：新增行，以及选择覆盖更新时有变更的已有方案。
 */
export function pendingDictionaryItems(
  rows: ImportPreviewRow[],
  includeDuplicates: boolean,
): { label: string; values: string[] }[] {
  const written = rows.filter(
    (row) =>
      row.status === 'valid' ||
      (includeDuplicates && row.status === 'duplicate'),
  );
  return dictionaryFields.flatMap(([field, label]) => {
    const values = new Map<string, string>();
    for (const row of written) {
      for (const text of row.newDictionaryLabels?.[field] ?? []) {
        const key = text.toLowerCase();
        if (!values.has(key)) values.set(key, text);
      }
    }
    return values.size > 0 ? [{ label, values: [...values.values()] }] : [];
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

const changedFieldLabels: Record<ImportChangedField, string> = {
  name: '名称',
  parentCode: '母方案',
  lengthMm: '展位长',
  widthMm: '展位宽',
  heightMm: '展位高',
  areaM2: '面积',
  openingCount: '开口面数',
  productSystemId: '产品体系',
  styleId: '风格',
  industryIds: '适用行业',
  budgetTierId: '预算档位',
  zoneIds: '功能分区',
  featureIds: '关键特征',
  description: '一句话描述',
  keywords: '关键词',
  notes: '备注',
};

function fieldNames(fields: ImportChangedField[] | undefined): string {
  return (fields ?? []).map((field) => changedFieldLabels[field]).join('、');
}

function notesOnly(row: ImportPreviewRow): boolean {
  const fields = row.changedFields ?? [];
  return fields.length > 0 && fields.every((field) => field === 'notes');
}

/** 预览“原因”列：错误原因，或已存在方案的变更与清空字段。 */
export function importRowNote(row: ImportPreviewRow): string {
  if (row.status === 'unchanged') return '与当前方案一致，无需更新';
  if (row.status !== 'duplicate') return row.reason ?? '';
  const parts = [`变更：${fieldNames(row.changedFields)}`];
  if (row.clearedFields?.length) {
    parts.push(`清空：${fieldNames(row.clearedFields)}`);
  }
  if (row.published && !notesOnly(row)) parts.push('将退回草稿');
  return parts.join('；');
}

/** 覆盖更新的影响：将写入的方案数、退回草稿的已发布方案数、含被清空字段的方案数。 */
export function overwriteImpact(rows: ImportPreviewRow[]): {
  clearing: number;
  unpublish: number;
  updates: number;
} {
  const duplicates = rows.filter((row) => row.status === 'duplicate');
  return {
    clearing: duplicates.filter((row) => row.clearedFields?.length).length,
    unpublish: duplicates.filter((row) => row.published && !notesOnly(row))
      .length,
    updates: duplicates.length,
  };
}
