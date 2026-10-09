import type { AssetType, SchemeAsset } from '#/api/core/assets';

import { describe, expect, it } from 'vitest';

import {
  otherResourceChecklist,
  renderingMaskChecklist,
} from '../resource-checklist';

function asset(
  id: string,
  type: AssetType,
  options: {
    height?: number;
    relatedAssetId?: null | string;
    sortOrder?: number;
    uploaded?: boolean;
    width?: number;
  } = {},
): SchemeAsset {
  const {
    height = 900,
    sortOrder = 0,
    uploaded = true,
    width = 1600,
  } = options;
  return {
    createdAt: `2026-10-0${sortOrder + 1}T00:00:00.000Z`,
    currentVersion: uploaded
      ? {
          assetId: id,
          byteSize: 1,
          checksum: 'c',
          createdAt: '',
          heightPx: height,
          id: `v-${id}`,
          mimeType: 'image/png',
          objectKey: id,
          originalFilename: `${id}.png`,
          pageCount: null,
          widthPx: width,
        }
      : null,
    id,
    isActive: true,
    metadata: {},
    name: id,
    relatedAssetId: options.relatedAssetId ?? null,
    revision: 1,
    schemeCode: 'S-1',
    schemeId: 'scheme',
    schemeName: '方案',
    sortOrder,
    type,
    updatedAt: '',
  };
}

describe('renderingMaskChecklist', () => {
  it('reports a complete set of three ready pairs', () => {
    const assets = [0, 1, 2].flatMap((order) => [
      asset(`R${order}`, 'rendering', { sortOrder: order }),
      asset(`M${order}`, 'mask', {
        relatedAssetId: `R${order}`,
        sortOrder: order,
      }),
    ]);
    const checklist = renderingMaskChecklist(assets);
    expect(checklist.slots.map((slot) => slot.issues)).toEqual([[], [], []]);
    expect(checklist.slots.map((slot) => slot.mask?.id)).toEqual([
      'M0',
      'M1',
      'M2',
    ]);
    expect(checklist.extraRenderings).toEqual([]);
    expect(checklist.unpairedMasks).toEqual([]);
  });

  it('lists every gap per pair in sort order and fills missing slots', () => {
    const assets = [
      asset('R2', 'rendering', { sortOrder: 2, height: 901 }),
      asset('R0', 'rendering', { sortOrder: 0 }),
      asset('M0', 'mask', {
        relatedAssetId: 'R0',
        sortOrder: 1,
        width: 800,
        height: 450,
      }),
      asset('M-orphan', 'mask', { relatedAssetId: 'gone' }),
    ];
    const checklist = renderingMaskChecklist(assets);
    expect(
      checklist.slots.map((slot) => [
        slot.index,
        slot.rendering?.id ?? null,
        slot.issues,
      ]),
    ).toEqual([
      [1, 'R0', ['蒙版尺寸与效果图不一致', '蒙版排序与效果图不一致']],
      [2, 'R2', ['效果图不是严格 16:9', '缺少蒙版']],
      [3, null, ['缺少效果图']],
    ]);
    expect(checklist.unpairedMasks.map((mask) => mask.id)).toEqual([
      'M-orphan',
    ]);
  });

  it('flags renderings beyond three, missing files and duplicate orders', () => {
    const assets = [
      asset('R0', 'rendering', { sortOrder: 0, uploaded: false }),
      asset('R1', 'rendering', { sortOrder: 1 }),
      asset('R1b', 'rendering', { sortOrder: 1 }),
      asset('R3', 'rendering', { sortOrder: 3 }),
    ];
    const checklist = renderingMaskChecklist(assets);
    expect(checklist.slots[0]?.issues).toEqual([
      '效果图未上传文件',
      '缺少蒙版',
    ]);
    expect(checklist.slots[1]?.issues).toContain('排序与其他效果图重复');
    expect(checklist.extraRenderings.map((item) => item.id)).toEqual(['R3']);
  });
});

describe('otherResourceChecklist', () => {
  it('requires at least one of each resource and a verified checklist', () => {
    const assets = [asset('D', 'drawing'), asset('C', 'checklist')];
    expect(
      otherResourceChecklist(
        assets,
        ['drawing', 'artwork', 'model', 'checklist'],
        false,
      ).map(({ issue, type }) => [type, issue]),
    ).toEqual([
      ['drawing', ''],
      ['artwork', '缺少平面素材'],
      ['model', '缺少模型'],
      ['checklist', '清单尚未核验'],
    ]);
    expect(
      otherResourceChecklist(assets, ['checklist'], undefined)[0]?.issue,
    ).toBe('');
    expect(otherResourceChecklist([], ['checklist'], undefined)[0]?.issue).toBe(
      '尚未导入清单',
    );
  });
});
