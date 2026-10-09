import type { ImportPreviewRow } from '#/api/core/schemes';

import { describe, expect, it } from 'vitest';

import { reasonMessage } from '#/api/reason-messages';

import {
  formatImportSize,
  formatOpeningCount,
  formatPreviewRemaining,
  importDictionaryEntries,
  importRowNote,
  overwriteImpact,
  previewRemainingMs,
} from '../import-preview';

const data = {
  areaM2: 18,
  heightMm: 4500,
  lengthMm: 6000,
  openingCount: 3,
  parentCode: null,
  widthMm: 3000,
};

describe('import preview presentation', () => {
  it('formats key dimensions in meters and marks missing values', () => {
    expect(formatImportSize(data)).toBe('6 × 3 × 4.5 m，18 ㎡');
    expect(formatImportSize({ ...data, areaM2: null, heightMm: null })).toBe(
      '6 × 3 × ? m',
    );
    expect(
      formatImportSize({
        ...data,
        areaM2: null,
        heightMm: null,
        lengthMm: null,
        widthMm: null,
      }),
    ).toBe('—');
    expect(formatImportSize()).toBe('—');
    expect(formatOpeningCount(4)).toBe('4 面');
    expect(formatOpeningCount(null)).toBe('—');
  });

  it('lists mapped dictionary labels in template column order', () => {
    expect(
      importDictionaryEntries({
        dictionaryLabels: {
          featureIds: [],
          styleId: ['现代简约'],
          productSystemId: ['FS62布框'],
          zoneIds: ['接待区', '洽谈区'],
        },
      }),
    ).toEqual([
      { label: '产品体系', values: ['FS62布框'] },
      { label: '风格', values: ['现代简约'] },
      { label: '功能分区', values: ['接待区', '洽谈区'] },
    ]);
    expect(importDictionaryEntries({})).toEqual([]);
  });

  it('counts down the preview validity and reports expiry', () => {
    const expiresAt = '2026-10-09T01:00:00.000Z';
    const at = (iso: string) => new Date(iso).getTime();
    expect(previewRemainingMs(expiresAt, at('2026-10-09T00:17:30Z'))).toBe(
      42.5 * 60_000,
    );
    expect(formatPreviewRemaining(42.5 * 60_000)).toBe('剩余 42 分钟');
    expect(formatPreviewRemaining(30_000)).toBe('剩余不足 1 分钟');
    expect(previewRemainingMs(expiresAt, at('2026-10-09T01:00:01Z'))).toBe(0);
    expect(formatPreviewRemaining(0)).toBe('预览已过期');
  });
});

describe('import error reasons', () => {
  it('names the mismatched sheet and column when details are present', () => {
    expect(
      reasonMessage('IMPORT_TEMPLATE_MISMATCH', {
        actual: '展位宽(m)',
        column: 'F',
        expected: '展位长(m)',
        sheetName: '华南',
      }),
    ).toBe(
      '工作表「华南」第 F 列表头应为“展位长(m)”，实际为“展位宽(m)”。请下载最新模板并按列填写',
    );
    expect(
      reasonMessage('IMPORT_TEMPLATE_MISMATCH', {
        actual: '',
        column: 'B',
        expected: '方案编号',
        sheetName: 'Sheet1',
      }),
    ).toContain('实际为空');
    expect(reasonMessage('IMPORT_TEMPLATE_MISMATCH')).toBe(
      '工作表表头与标准模板不一致，请下载最新模板并按列填写',
    );
  });

  it('distinguishes invalid, oversized, expired, conflicting and forbidden imports', () => {
    const reasons = [
      'IMPORT_FILE_INVALID',
      'FILE_TOO_LARGE',
      'IMPORT_PREVIEW_EXPIRED',
      'IMPORT_ALREADY_COMMITTED',
      'ACCESS_DENIED',
    ];
    const messages = reasons.map((reason) => reasonMessage(reason));
    expect(messages.every(Boolean)).toBe(true);
    expect(new Set(messages).size).toBe(reasons.length);
    expect(reasonMessage(undefined)).toBeUndefined();
    expect(reasonMessage('UNKNOWN_REASON')).toBeUndefined();
  });
});

function row(overrides: Partial<ImportPreviewRow>): ImportPreviewRow {
  return {
    code: 'S-1',
    name: '方案',
    rowId: 1,
    rowNumber: 2,
    sheetName: '方案',
    status: 'duplicate',
    ...overrides,
  };
}

describe('overwrite impact', () => {
  it('explains changed and cleared fields and whether the scheme is retracted', () => {
    expect(
      importRowNote(
        row({
          changedFields: ['name', 'parentCode'],
          clearedFields: ['parentCode'],
          published: true,
        }),
      ),
    ).toBe('变更：名称、母方案；清空：母方案；将退回草稿');
    expect(
      importRowNote(
        row({ changedFields: ['notes'], clearedFields: [], published: true }),
      ),
    ).toBe('变更：备注');
    expect(importRowNote(row({ status: 'unchanged' }))).toBe(
      '与当前方案一致，无需更新',
    );
    expect(
      importRowNote(row({ reason: '未映射的标签：X', status: 'error' })),
    ).toBe('未映射的标签：X');
  });

  it('counts overwritten, retracted and clearing schemes, ignoring notes-only and unchanged rows', () => {
    expect(
      overwriteImpact([
        row({ changedFields: ['name'], clearedFields: [], published: true }),
        row({
          changedFields: ['notes'],
          clearedFields: ['notes'],
          published: true,
        }),
        row({
          changedFields: ['keywords'],
          clearedFields: ['keywords'],
          published: false,
        }),
        row({ published: true, status: 'unchanged' }),
        row({ status: 'valid' }),
      ]),
    ).toEqual({ clearing: 2, unpublish: 1, updates: 3 });
  });
});
