import { describe, expect, it } from 'vitest';

import {
  buildArtworkMetadata,
  formatArtworkSize,
  readArtworkFields,
  wallPositionOptions,
} from '../artwork-metadata';

describe('buildArtworkMetadata', () => {
  it('writes per-image wall position and size with the unit', () => {
    expect(
      buildArtworkMetadata({
        wallPosition: ' 正面左墙 ',
        physicalWidth: 3000,
        physicalHeight: 2500,
        dimensionUnit: 'mm',
      }),
    ).toEqual({
      wallPosition: '正面左墙',
      physicalWidth: 3000,
      physicalHeight: 2500,
      dimensionUnit: 'mm',
    });
  });

  it('omits blank fields and the unit when no size is given', () => {
    expect(
      buildArtworkMetadata({
        wallPosition: '  ',
        physicalWidth: null,
        physicalHeight: undefined,
        dimensionUnit: 'cm',
      }),
    ).toEqual({});
  });

  it('keeps unrelated keys and removes cleared fields when editing', () => {
    expect(
      buildArtworkMetadata(
        {
          wallPosition: '',
          physicalWidth: 2,
          physicalHeight: null,
          dimensionUnit: 'm',
        },
        {
          dimensionEvidence: '施工图',
          wallPosition: '背景墙',
          physicalWidth: 1,
          physicalHeight: 1,
          dimensionUnit: 'mm',
        },
      ),
    ).toEqual({
      dimensionEvidence: '施工图',
      physicalWidth: 2,
      dimensionUnit: 'm',
    });
  });
});

describe('readArtworkFields', () => {
  it('reads valid values and falls back to mm', () => {
    expect(
      readArtworkFields({
        wallPosition: '左侧墙',
        physicalWidth: 1200,
        physicalHeight: 'x',
        dimensionUnit: 'inch',
      }),
    ).toEqual({
      wallPosition: '左侧墙',
      physicalWidth: 1200,
      physicalHeight: null,
      dimensionUnit: 'mm',
    });
  });
});

describe('formatArtworkSize', () => {
  it('formats width, height and unit', () => {
    expect(
      formatArtworkSize({
        physicalWidth: 3000,
        physicalHeight: 2500,
        dimensionUnit: 'mm',
      }),
    ).toBe('3000 × 2500 mm');
    expect(formatArtworkSize({ physicalWidth: 3 })).toBe('3 × -');
    expect(formatArtworkSize({})).toBe('-');
  });
});

describe('wallPositionOptions', () => {
  it('lists positions used in the scheme first, then common ones, without duplicates', () => {
    const values = wallPositionOptions([
      { metadata: { wallPosition: '正面左墙' } },
      { metadata: { wallPosition: ' 背景墙 ' } },
      { metadata: { wallPosition: '正面左墙' } },
      { metadata: {} },
    ]).map((option) => option.value);
    expect(values.slice(0, 2)).toEqual(['正面左墙', '背景墙']);
    expect(values.filter((value) => value === '背景墙')).toHaveLength(1);
    expect(values).toContain('左侧墙');
  });
});
