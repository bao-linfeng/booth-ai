import { describe, expect, it } from 'vitest';

import { reasonMessage } from '#/api/reason-messages';

describe('asset upload error reasons', () => {
  it('names the invalid metadata field and the rule it violates', () => {
    expect(
      reasonMessage('ASSET_METADATA_INVALID', {
        field: 'artworkKey',
        rule: 'required',
      }),
    ).toBe('请填写画面键');
    expect(
      reasonMessage('ASSET_METADATA_INVALID', {
        field: 'physicalWidth',
        rule: 'positive_number',
      }),
    ).toBe('物理宽度需为大于 0 的数字');
    expect(
      reasonMessage('ASSET_METADATA_INVALID', {
        field: 'dimensionUnit',
        rule: 'unit',
      }),
    ).toBe('尺寸单位只能是 mm、cm 或 m');
    expect(
      reasonMessage('ASSET_METADATA_INVALID', {
        field: 'viewCodes',
        rule: 'string_array',
      }),
    ).toBe('视向格式不正确');
  });

  it('names the invalid upload field', () => {
    expect(reasonMessage('ASSET_FIELD_INVALID', { field: 'name' })).toBe(
      '「资源名称」缺失或格式不正确，请检查后重试',
    );
  });

  it('falls back to the generic message without known field details', () => {
    expect(reasonMessage('ASSET_METADATA_INVALID')).toBe(
      '资源附加信息格式不正确，请检查后重试',
    );
    expect(
      reasonMessage('ASSET_METADATA_INVALID', { field: 'unknown', rule: 'x' }),
    ).toBe('资源附加信息格式不正确，请检查后重试');
    expect(reasonMessage('ASSET_FIELD_INVALID', null)).toBe(
      '资源信息不完整或格式不正确，请检查后重试',
    );
  });

  it('distinguishes the remaining upload, pairing and conflict failures', () => {
    const reasons = [
      'FILE_REQUIRED',
      'TOO_MANY_FILES',
      'MASK_RENDERING_REQUIRED',
      'RELATED_ASSET_INVALID',
      'RENDERING_ALREADY_PAIRED',
      'ASSET_REVISION_CONFLICT',
      'ASSET_NO_CHANGES',
      'ASSET_FILE_MISSING',
      'RESOURCE_NOT_FOUND',
    ];
    const messages = reasons.map((reason) => reasonMessage(reason));
    expect(messages.every(Boolean)).toBe(true);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});
