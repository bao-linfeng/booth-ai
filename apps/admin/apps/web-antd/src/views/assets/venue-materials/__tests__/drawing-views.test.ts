import { describe, expect, it } from 'vitest';

import {
  buildDrawingMetadata,
  formatViewCodes,
  guessViewCodes,
  readViewCodes,
} from '../drawing-views';

describe('drawing views', () => {
  it('reads known view codes in option order and ignores legacy values', () => {
    expect(
      readViewCodes({ viewCodes: ['top', 'side', 'back', 'front'] }),
    ).toEqual(['front', 'top']);
    expect(readViewCodes({ viewCodes: 'front' })).toEqual([]);
    expect(readViewCodes({})).toEqual([]);
  });

  it('formats view codes as labels', () => {
    expect(formatViewCodes({ viewCodes: ['left', 'front'] })).toBe(
      '正视图、左视图',
    );
    expect(formatViewCodes({})).toBe('-');
  });

  it('guesses view codes from SketchUp export filenames', () => {
    expect(guessViewCodes('TW36_BK_025_APP-正视图.jpg')).toEqual(['front']);
    expect(guessViewCodes('TW36_BK_025_APP-左视图')).toEqual(['left']);
    expect(guessViewCodes('展台俯视图.png')).toEqual(['top']);
    expect(guessViewCodes('展台顶视图.png')).toEqual(['top']);
    expect(guessViewCodes('后视图')).toEqual([]);
    expect(guessViewCodes('施工说明.pdf')).toEqual([]);
  });

  it('merges view codes into existing metadata and drops the key when empty', () => {
    const base = { purpose: '施工', viewCodes: ['side'] };
    expect(buildDrawingMetadata(['top', 'front'], base)).toEqual({
      purpose: '施工',
      viewCodes: ['front', 'top'],
    });
    expect(buildDrawingMetadata([], base)).toEqual({ purpose: '施工' });
    expect(buildDrawingMetadata(['left'])).toEqual({ viewCodes: ['left'] });
  });
});
