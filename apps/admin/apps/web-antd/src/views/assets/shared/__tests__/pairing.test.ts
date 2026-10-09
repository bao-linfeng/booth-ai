import type { AssetVersion } from '#/api/core/assets';

import { describe, expect, it } from 'vitest';

import { renderingDeletePlan, renderingPairOptions } from '../pairing';

function version(widthPx: number, heightPx: number): AssetVersion {
  return {
    assetId: 'a',
    byteSize: 1,
    checksum: 'c',
    createdAt: '',
    heightPx,
    id: 'v',
    mimeType: 'image/png',
    objectKey: 'k',
    originalFilename: 'f.png',
    pageCount: null,
    widthPx,
  };
}

describe('renderingDeletePlan', () => {
  const rendering = { id: 'r1', name: '主视角' };

  it('无配对蒙版时按普通删除确认', () => {
    const plan = renderingDeletePlan(
      rendering,
      [{ name: '其他', relatedAssetId: 'r2' }],
      true,
    );
    expect(plan).toMatchObject({ blocked: false, withPairedMasks: false });
    expect(plan.content).toBe('确定要删除「主视角」吗？');
  });

  it('有配对蒙版时说明影响并一并删除', () => {
    const plan = renderingDeletePlan(
      rendering,
      [{ name: '主视角蒙版', relatedAssetId: 'r1' }],
      true,
    );
    expect(plan).toMatchObject({ blocked: false, withPairedMasks: true });
    expect(plan.content).toContain('「主视角蒙版」');
    expect(plan.content).toContain('一并删除');
  });

  it('没有删除蒙版权限时阻止删除并引导改配', () => {
    const plan = renderingDeletePlan(
      rendering,
      [{ name: '主视角蒙版', relatedAssetId: 'r1' }],
      false,
    );
    expect(plan).toMatchObject({ blocked: true, withPairedMasks: false });
    expect(plan.content).toContain('改配');
  });
});

describe('renderingPairOptions', () => {
  const mask = {
    currentVersion: version(1600, 900),
    id: 'm1',
    name: '蒙版',
    relatedAssetId: null,
  };

  it('只开放已上传、尺寸一致且未被占用的效果图', () => {
    const options = renderingPairOptions(
      mask,
      [
        {
          currentVersion: version(1600, 900),
          id: 'ok',
          name: 'A',
          relatedAssetId: null,
        },
        {
          currentVersion: version(1920, 1080),
          id: 'size',
          name: 'B',
          relatedAssetId: null,
        },
        { currentVersion: null, id: 'empty', name: 'C', relatedAssetId: null },
        {
          currentVersion: version(1600, 900),
          id: 'taken',
          name: 'D',
          relatedAssetId: null,
        },
      ],
      [
        mask,
        {
          currentVersion: null,
          id: 'm2',
          name: '其他',
          relatedAssetId: 'taken',
        },
      ],
    );
    expect(options).toEqual([
      { disabled: false, label: 'A（1600×900）', value: 'ok' },
      { disabled: true, label: 'B（1920×1080） · 尺寸不一致', value: 'size' },
      { disabled: true, label: 'C · 未上传文件', value: 'empty' },
      {
        disabled: true,
        label: 'D（1600×900） · 已配对其他蒙版',
        value: 'taken',
      },
    ]);
  });

  it('当前蒙版自己的配对不算占用', () => {
    const paired = { ...mask, relatedAssetId: 'ok' };
    const [option] = renderingPairOptions(
      paired,
      [
        {
          currentVersion: version(1600, 900),
          id: 'ok',
          name: 'A',
          relatedAssetId: null,
        },
      ],
      [paired],
    );
    expect(option?.disabled).toBe(false);
  });
});
