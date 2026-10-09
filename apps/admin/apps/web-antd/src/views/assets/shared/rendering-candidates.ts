import type { ImageSize } from './image-spec';

import type { MaskPairingCandidate } from '#/api/core/assets';

import { ref } from 'vue';

import { listMaskPairingCandidatesApi } from '#/api/core/assets';

import { formatImageSize, versionImageSize } from './image-spec';

export interface RenderingCandidate {
  disabled: boolean;
  label: string;
  value: string;
  filename: null | string;
  /** 已被其他蒙版占用时为该蒙版；可替换时选中后改为替换其文件 */
  pairedMask: MaskPairingCandidate['pairedMask'];
  sizeText: null | string;
  sortOrder: number;
  status: string;
  thumbnailUrl: null | string;
}

/**
 * 候选展示与可选性：未上传文件不可选；已被其他蒙版占用时，有蒙版替换权限才可选（选中即替换该蒙版文件），
 * 否则禁用，避免提交后才被服务端以 409 拒绝。
 */
export function renderingCandidate(
  candidate: MaskPairingCandidate,
  canReplaceMask: boolean,
): RenderingCandidate {
  const size = versionImageSize(candidate.file);
  const sizeText = size ? formatImageSize(size) : null;
  let status = '可配对';
  if (!size) status = '未上传文件';
  else if (candidate.pairedMask) {
    status = canReplaceMask
      ? `已配对「${candidate.pairedMask.name}」，选择后替换其文件`
      : `已配对「${candidate.pairedMask.name}」`;
  }
  return {
    disabled: !size || (!!candidate.pairedMask && !canReplaceMask),
    filename: candidate.file?.originalFilename ?? null,
    label: `#${candidate.sortOrder + 1} ${candidate.name}（${sizeText ?? '未上传文件'}）`,
    pairedMask: candidate.pairedMask,
    sizeText,
    sortOrder: candidate.sortOrder,
    status,
    thumbnailUrl: candidate.thumbnailUrl,
    value: candidate.id,
  };
}

/**
 * 上传蒙版时可配对的效果图候选。只采用最后一次 `load` 的响应；
 * `reset`（切换方案、关闭弹窗）会让进行中的请求作废，旧方案的回包不会覆盖当前候选。
 */
export function useRenderingCandidates(canReplaceMask: () => boolean) {
  const options = ref<RenderingCandidate[]>([]);
  const loading = ref(false);
  const sizes = new Map<string, ImageSize | null>();
  let sequence = 0;

  function reset() {
    sequence++;
    options.value = [];
    sizes.clear();
    loading.value = false;
  }

  async function load(schemeCode: string) {
    reset();
    const current = sequence;
    loading.value = true;
    try {
      const candidates = await listMaskPairingCandidatesApi(schemeCode);
      if (current !== sequence) return;
      const replaceable = canReplaceMask();
      options.value = candidates.map((candidate) => {
        sizes.set(candidate.id, versionImageSize(candidate.file));
        return renderingCandidate(candidate, replaceable);
      });
    } catch {
      // 加载失败时保持空候选
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  function sizeOf(renderingId: string): ImageSize | null {
    return sizes.get(renderingId) ?? null;
  }

  function candidateOf(
    renderingId: string | undefined,
  ): RenderingCandidate | undefined {
    return options.value.find((option) => option.value === renderingId);
  }

  return { candidateOf, load, loading, options, reset, sizeOf };
}
