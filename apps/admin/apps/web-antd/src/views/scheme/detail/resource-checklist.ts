import type { SchemeAsset } from '#/api/core/assets';

import {
  formatImageSize,
  renderingSizeError,
  versionImageSize,
} from '../../assets/shared/image-spec';

/** 发布要求的效果图 + 蒙版组数，与服务端就绪检查一致。 */
export const REQUIRED_PAIRS = 3;

export interface PairSlot {
  /** 第几组（从 1 起） */
  index: number;
  rendering: null | SchemeAsset;
  mask: null | SchemeAsset;
  issues: string[];
}

export interface PairChecklist {
  slots: PairSlot[];
  /** 超出 3 张、需删除或替换的效果图 */
  extraRenderings: SchemeAsset[];
  /** 未配对或指向已失效效果图的蒙版 */
  unpairedMasks: SchemeAsset[];
}

function bySortOrder(a: SchemeAsset, b: SchemeAsset): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

function sizeText(asset: SchemeAsset): string {
  const size = versionImageSize(asset.currentVersion);
  return size ? formatImageSize(size) : '未上传文件';
}

export function assetLabel(asset: SchemeAsset): string {
  return `${asset.name}（${sizeText(asset)}）`;
}

function pairIssues(
  rendering: SchemeAsset,
  mask: null | SchemeAsset,
  duplicateOrder: boolean,
): string[] {
  const issues: string[] = [];
  const size = versionImageSize(rendering.currentVersion);
  if (!size) issues.push('效果图未上传文件');
  else if (renderingSizeError(size)) issues.push('效果图不是严格 16:9');
  if (duplicateOrder) issues.push('排序与其他效果图重复');
  if (!mask) {
    issues.push('缺少蒙版');
    return issues;
  }
  const maskSize = versionImageSize(mask.currentVersion);
  if (!maskSize) issues.push('蒙版未上传文件');
  else if (
    size &&
    (maskSize.width !== size.width || maskSize.height !== size.height)
  ) {
    issues.push('蒙版尺寸与效果图不一致');
  }
  if (mask.sortOrder !== rendering.sortOrder) {
    issues.push('蒙版排序与效果图不一致');
  }
  return issues;
}

/** 按发布要求把效果图与蒙版排成 3 组，列出每组缺口，以及多余的效果图和未配对的蒙版。 */
export function renderingMaskChecklist(assets: SchemeAsset[]): PairChecklist {
  const renderings = assets
    .filter((asset) => asset.type === 'rendering')
    .toSorted((a, b) => bySortOrder(a, b));
  const masks = assets.filter((asset) => asset.type === 'mask');
  const renderingIds = new Set(renderings.map((rendering) => rendering.id));
  const orderCounts = new Map<number, number>();
  for (const rendering of renderings) {
    orderCounts.set(
      rendering.sortOrder,
      (orderCounts.get(rendering.sortOrder) ?? 0) + 1,
    );
  }
  const slots: PairSlot[] = renderings
    .slice(0, REQUIRED_PAIRS)
    .map((rendering, index) => {
      const mask =
        masks.find((item) => item.relatedAssetId === rendering.id) ?? null;
      return {
        index: index + 1,
        issues: pairIssues(
          rendering,
          mask,
          (orderCounts.get(rendering.sortOrder) ?? 0) > 1,
        ),
        mask,
        rendering,
      };
    });
  while (slots.length < REQUIRED_PAIRS) {
    slots.push({
      index: slots.length + 1,
      issues: ['缺少效果图'],
      mask: null,
      rendering: null,
    });
  }
  return {
    extraRenderings: renderings.slice(REQUIRED_PAIRS),
    slots,
    unpairedMasks: masks.filter(
      (mask) => !mask.relatedAssetId || !renderingIds.has(mask.relatedAssetId),
    ),
  };
}

export type OtherResourceType = 'artwork' | 'checklist' | 'drawing' | 'model';

export interface OtherResource {
  type: OtherResourceType;
  label: string;
  count: number;
  /** 缺口说明，为空表示已满足发布要求 */
  issue: string;
}

const otherResourceLabels: Record<OtherResourceType, string> = {
  drawing: '报馆图',
  artwork: '平面素材',
  model: '模型',
  checklist: '简化清单',
};

/** 报馆图、平面素材、模型至少各 1 个；清单需已导入并核验（未知核验状态时只检查数量）。 */
export function otherResourceChecklist(
  assets: SchemeAsset[],
  types: OtherResourceType[],
  checklistVerified: boolean | undefined,
): OtherResource[] {
  return types.map((type) => {
    const count = assets.filter((asset) => asset.type === type).length;
    let issue = count === 0 ? `缺少${otherResourceLabels[type]}` : '';
    if (type === 'checklist') {
      if (count === 0) issue = '尚未导入清单';
      else if (checklistVerified === false) issue = '清单尚未核验';
    }
    return { count, issue, label: otherResourceLabels[type], type };
  });
}
