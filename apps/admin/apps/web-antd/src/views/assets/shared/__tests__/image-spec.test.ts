import { describe, expect, it } from 'vitest';

import {
  maskSizeError,
  pairedMaskWarning,
  renderingSizeError,
  versionImageSize,
} from '../image-spec';

describe('renderingSizeError', () => {
  it('只接受严格 16:9', () => {
    expect(renderingSizeError({ width: 1600, height: 900 })).toBeUndefined();
    expect(renderingSizeError({ width: 1920, height: 1080 })).toBeUndefined();
    expect(renderingSizeError({ width: 1600, height: 901 })).toContain(
      '当前 1600×901',
    );
    expect(renderingSizeError({ width: 0, height: 0 })).toBeDefined();
  });
});

describe('maskSizeError', () => {
  const rendering = { width: 1600, height: 900 };

  it('蒙版必须与配对效果图像素一致', () => {
    expect(maskSizeError({ width: 1600, height: 900 }, rendering)).toBe(
      undefined,
    );
    expect(maskSizeError({ width: 800, height: 450 }, rendering)).toBe(
      '蒙版尺寸需与配对效果图一致（1600×900），当前 800×450',
    );
  });

  it('配对效果图没有文件时拒绝', () => {
    expect(maskSizeError({ width: 1600, height: 900 }, null)).toContain(
      '尚未上传文件',
    );
  });
});

describe('pairedMaskWarning', () => {
  const mask = (widthPx: null | number, heightPx: null | number) => ({
    name: '蒙版 A',
    currentVersion: { widthPx, heightPx },
  });

  it('替换后与已配对蒙版尺寸不一致时提示', () => {
    expect(
      pairedMaskWarning({ width: 1920, height: 1080 }, mask(1600, 900)),
    ).toContain('「蒙版 A」为 1600×900，与新效果图 1920×1080 不一致');
  });

  it('尺寸一致、没有蒙版或蒙版无文件时不提示', () => {
    const next = { width: 1600, height: 900 };
    expect(pairedMaskWarning(next, mask(1600, 900))).toBeUndefined();
    expect(pairedMaskWarning(next, undefined)).toBeUndefined();
    expect(pairedMaskWarning(next, mask(null, null))).toBeUndefined();
  });
});

describe('versionImageSize', () => {
  it('缺少尺寸时返回 null', () => {
    expect(versionImageSize(null)).toBeNull();
    expect(versionImageSize({ widthPx: 1600, heightPx: null })).toBeNull();
    expect(versionImageSize({ widthPx: 1600, heightPx: 900 })).toEqual({
      width: 1600,
      height: 900,
    });
  });
});
