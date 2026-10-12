import { describe, expect, it } from 'vitest';

import { defaultAssetName } from '../upload-name';

describe('defaultAssetName', () => {
  it('drops only the last extension', () => {
    expect(defaultAssetName('正面左墙.png')).toBe('正面左墙');
    expect(defaultAssetName('a.v2.jpg')).toBe('a.v2');
    expect(defaultAssetName('README')).toBe('README');
    expect(defaultAssetName('.png')).toBe('.png');
  });
});
