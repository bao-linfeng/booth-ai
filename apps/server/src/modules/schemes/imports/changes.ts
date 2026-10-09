import { changedSchemeFields, type SchemeInput, type SchemeRecord } from '../service.js';
import type { ImportChangedField, ImportRow } from './types.js';

/** 导入覆盖写入的字段，须与 commit.ts 的 updateSql 一致。 */
export function importSchemeInput(data: ImportRow): SchemeInput {
  return {
    name: data.name, parentCode: data.parentCode, lengthMm: data.lengthMm, widthMm: data.widthMm,
    heightMm: data.heightMm, areaM2: data.areaM2, openingCount: data.openingCount,
    productSystemId: data.productSystemId, styleId: data.styleId, industryIds: data.industryIds ?? [],
    budgetTierId: data.budgetTierId, zoneIds: data.zoneIds ?? [], featureIds: data.featureIds ?? [],
    description: data.description, keywords: data.keywords, notes: data.notes,
  };
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** 覆盖已有方案时实际变化的字段，以及其中因单元格为空而将被清空的字段。 */
export function importRowChanges(current: SchemeRecord, data: ImportRow): { changedFields: ImportChangedField[]; clearedFields: ImportChangedField[] } {
  const input = importSchemeInput(data);
  const changedFields = changedSchemeFields(current, input) as ImportChangedField[];
  return { changedFields, clearedFields: changedFields.filter(field => isEmpty(input[field])) };
}

/** 仅改内部备注不影响匹配与交付：与手动编辑一致，不递增修订、不使审核失效、不下架。 */
export function onlyNotesChanged(changedFields: readonly ImportChangedField[]): boolean {
  return changedFields.length > 0 && changedFields.every(field => field === 'notes');
}
