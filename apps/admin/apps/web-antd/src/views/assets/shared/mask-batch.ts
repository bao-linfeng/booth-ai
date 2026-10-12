import type { ImageSize } from './image-spec';
import type { RenderingCandidate } from './rendering-candidates';

import { defaultAssetName } from './upload-name';

export interface MaskFile {
  key: string;
  filename: string;
  size: ImageSize;
}

function normalized(name: string): string {
  return defaultAssetName(name).trim().toLowerCase();
}

/**
 * 批量上传蒙版时为各文件推荐配对效果图。只在可选、尺寸一致、尚未配对蒙版且未被本批其他文件选用的效果图中挑选；
 * 已配对蒙版的效果图选中即替换其文件，必须手动选择。依次按以下顺序分配，避免按顺序兜底的文件抢走别人同名的效果图：
 * 1. 指定的效果图（从方案详情为某组补蒙版）；2. 文件名与效果图文件名或名称一致；3. 按效果图排序取第一个。
 */
export function suggestRenderings(
  files: MaskFile[],
  candidates: RenderingCandidate[],
  sizeOf: (renderingId: string) => ImageSize | null,
  taken: ReadonlySet<string>,
  preferredId?: string,
): Map<string, string> {
  const used = new Set(taken);
  const result = new Map<string, string>();
  const ordered = candidates.toSorted((a, b) => a.sortOrder - b.sortOrder);

  function assign(
    pick: (file: MaskFile, candidate: RenderingCandidate) => boolean,
  ) {
    for (const file of files) {
      if (result.has(file.key)) continue;
      const candidate = ordered.find((item) => {
        const size = sizeOf(item.value);
        return (
          !item.disabled &&
          !item.pairedMask &&
          !used.has(item.value) &&
          size?.width === file.size.width &&
          size.height === file.size.height &&
          pick(file, item)
        );
      });
      if (!candidate) continue;
      result.set(file.key, candidate.value);
      used.add(candidate.value);
    }
  }

  if (preferredId) assign((_, candidate) => candidate.value === preferredId);
  assign((file, candidate) => {
    const name = normalized(file.filename);
    return (
      (!!candidate.filename && normalized(candidate.filename) === name) ||
      candidate.name.trim().toLowerCase() === name
    );
  });
  assign(() => true);
  return result;
}
