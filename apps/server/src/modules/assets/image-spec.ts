/** 效果图必须严格 16:9，与发布就绪检查共用同一条规则。 */
export function isRenderingAspect(widthPx: number, heightPx: number): boolean {
  return widthPx > 0 && heightPx > 0 && widthPx * 9 === heightPx * 16;
}

export type MaybeImageSize = { widthPx?: number | null; heightPx?: number | null } | null | undefined;

export function sameImageSize(a: MaybeImageSize, b: MaybeImageSize): boolean {
  return !!a?.widthPx && !!a.heightPx && a.widthPx === b?.widthPx && a.heightPx === b.heightPx;
}
