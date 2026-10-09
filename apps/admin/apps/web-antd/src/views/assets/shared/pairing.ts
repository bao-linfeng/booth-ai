import type { SchemeAsset } from '#/api/core/assets';

import { formatImageSize, maskSizeError, versionImageSize } from './image-spec';

type PairAsset = Pick<
  SchemeAsset,
  'currentVersion' | 'id' | 'name' | 'relatedAssetId'
>;

export interface RenderingDeletePlan {
  /** 无法在此删除时只提示，不提供确认 */
  blocked: boolean;
  content: string;
  title: string;
  withPairedMasks: boolean;
}

/** 删除效果图前说明对配对蒙版的影响；服务端拒绝删除仍有活动蒙版的效果图，除非确认一并删除。 */
export function renderingDeletePlan(
  rendering: Pick<SchemeAsset, 'id' | 'name'>,
  masks: Pick<SchemeAsset, 'name' | 'relatedAssetId'>[],
  canDeleteMasks: boolean,
): RenderingDeletePlan {
  const paired = masks.filter((mask) => mask.relatedAssetId === rendering.id);
  if (paired.length === 0) {
    return {
      blocked: false,
      content: `确定要删除「${rendering.name}」吗？`,
      title: '确认删除',
      withPairedMasks: false,
    };
  }
  const names = paired.map((mask) => `「${mask.name}」`).join('、');
  if (!canDeleteMasks) {
    return {
      blocked: true,
      content: `效果图「${rendering.name}」已配对蒙版${names}，你没有删除蒙版的权限。请先在蒙版管理中将其改配其他效果图，或联系有权限的管理员处理。`,
      title: '无法删除效果图',
      withPairedMasks: false,
    };
  }
  return {
    blocked: false,
    content: `效果图「${rendering.name}」已配对蒙版${names}，删除后蒙版将一并删除，方案需补齐效果图与蒙版并重新审核后才能发布。如只需更换图片，请使用「替换」。`,
    title: '删除效果图及配对蒙版',
    withPairedMasks: true,
  };
}

export interface RenderingPairOption {
  disabled: boolean;
  label: string;
  value: string;
}

/** 蒙版可配对的效果图：须已上传文件、尺寸与蒙版一致，且未被其他蒙版占用。 */
export function renderingPairOptions(
  mask: PairAsset,
  renderings: PairAsset[],
  masks: PairAsset[],
): RenderingPairOption[] {
  const maskSize = versionImageSize(mask.currentVersion);
  const taken = new Set(
    masks
      .filter((other) => other.id !== mask.id && other.relatedAssetId)
      .map((other) => other.relatedAssetId),
  );
  return renderings.map((rendering) => {
    const size = versionImageSize(rendering.currentVersion);
    let reason: string | undefined;
    if (taken.has(rendering.id)) reason = '已配对其他蒙版';
    else if (!size) reason = '未上传文件';
    else if (maskSize && maskSizeError(maskSize, size)) reason = '尺寸不一致';
    const sizeText = size ? formatImageSize(size) : '';
    return {
      disabled: reason !== undefined,
      label: `${rendering.name}${sizeText ? `（${sizeText}）` : ''}${reason ? ` · ${reason}` : ''}`,
      value: rendering.id,
    };
  });
}
