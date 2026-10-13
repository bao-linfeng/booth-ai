/** 报馆图视向（SketchUp 标准三视图）；左右以站在正面入口外、面向展台时的左右手为准。 */
export type DrawingViewCode = 'front' | 'left' | 'top';

export const VIEW_CODE_OPTIONS: { label: string; value: DrawingViewCode }[] = [
  { label: '正视图', value: 'front' },
  { label: '左视图', value: 'left' },
  { label: '俯视图', value: 'top' },
];

export const VIEW_CODE_HINT =
  '四向图生成按视向附带报馆图校正结构：俯视图 + 对应方向的立面；背面、右侧分别用正视图、左视图翻转。';

const FILENAME_KEYWORDS: [DrawingViewCode, RegExp][] = [
  ['front', /正视|前视|正立面/],
  ['left', /左视|左立面/],
  ['top', /俯视|顶视|平面/],
];

/** 读出合法视向，按选项顺序排列；未知取值（如旧的 side）忽略。 */
export function readViewCodes(
  metadata: Record<string, unknown>,
): DrawingViewCode[] {
  const codes = Array.isArray(metadata.viewCodes) ? metadata.viewCodes : [];
  return VIEW_CODE_OPTIONS.map((option) => option.value).filter((code) =>
    codes.includes(code),
  );
}

export function formatViewCodes(metadata: Record<string, unknown>): string {
  const codes = readViewCodes(metadata);
  return codes.length > 0
    ? VIEW_CODE_OPTIONS.filter((option) => codes.includes(option.value))
        .map((option) => option.label)
        .join('、')
    : '-';
}

/** 按文件名（如「TW36-左视图.jpg」）预填视向，识别不出时为空。 */
export function guessViewCodes(filename: string): DrawingViewCode[] {
  return FILENAME_KEYWORDS.filter(([, pattern]) => pattern.test(filename)).map(
    ([code]) => code,
  );
}

/**
 * 把视向合并进原 metadata：保留其他键（用途、适用范围等），未选视向时删除该键。
 * 服务端 PATCH 整体替换 metadata，因此编辑时必须传入原值。
 */
export function buildDrawingMetadata(
  viewCodes: DrawingViewCode[],
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const { viewCodes: _previous, ...rest } = base;
  const codes = VIEW_CODE_OPTIONS.map((option) => option.value).filter((code) =>
    viewCodes.includes(code),
  );
  return codes.length > 0 ? { ...rest, viewCodes: codes } : rest;
}
