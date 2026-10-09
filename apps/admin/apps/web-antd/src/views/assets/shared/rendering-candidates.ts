import type { ImageSize } from './image-spec';

import { ref } from 'vue';

import { listSchemeAssetsApi } from '#/api/core/assets';

import { formatImageSize, versionImageSize } from './image-spec';

export interface RenderingCandidate {
  disabled: boolean;
  label: string;
  value: string;
}

/**
 * 上传蒙版时可配对的效果图候选。只采用最后一次 `load` 的响应；
 * `reset`（切换方案、关闭弹窗）会让进行中的请求作废，旧方案的回包不会覆盖当前候选。
 */
export function useRenderingCandidates() {
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
      const assets = await listSchemeAssetsApi(schemeCode, 'rendering');
      if (current !== sequence) return;
      options.value = assets.map((asset) => {
        const size = versionImageSize(asset.currentVersion);
        sizes.set(asset.id, size);
        return {
          disabled: !size,
          label: `${asset.name}（${size ? formatImageSize(size) : '未上传文件'}）`,
          value: asset.id,
        };
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

  return { load, loading, options, reset, sizeOf };
}
