import type { ImageSize } from '../image-spec';
import type { RenderingCandidate } from '../rendering-candidates';

import { describe, expect, it } from 'vitest';

import { suggestRenderings } from '../mask-batch';

const FHD: ImageSize = { width: 1920, height: 1080 };
const HD: ImageSize = { width: 1600, height: 900 };

function candidate(
  id: string,
  sortOrder: number,
  overrides: Partial<RenderingCandidate> = {},
): RenderingCandidate {
  return {
    disabled: false,
    filename: `${id}.png`,
    label: id,
    name: id,
    pairedMask: null,
    sizeText: null,
    sortOrder,
    status: '可配对',
    thumbnailUrl: null,
    value: id,
    ...overrides,
  };
}

function suggest(
  files: Array<[string, ImageSize?]>,
  candidates: RenderingCandidate[],
  options: {
    preferredId?: string;
    sizes?: Record<string, ImageSize>;
    taken?: string[];
  } = {},
) {
  return Object.fromEntries(
    suggestRenderings(
      files.map(([filename, size]) => ({
        filename,
        key: filename,
        size: size ?? FHD,
      })),
      candidates,
      (id) => options.sizes?.[id] ?? FHD,
      new Set(options.taken),
      options.preferredId,
    ),
  );
}

describe('suggestRenderings', () => {
  it('同名优先，其余按效果图排序依次分配，同名文件不会被前面的文件抢走', () => {
    const candidates = [
      candidate('图1', 0, { filename: 'A (1).png' }),
      candidate('图2', 1, { filename: 'A (2).png' }),
      candidate('图3', 2, { filename: 'A (3).png' }),
    ];
    expect(
      suggest([['其他.png'], ['A (2).png'], ['图1.jpg']], candidates),
    ).toEqual({
      'A (2).png': '图2',
      '图1.jpg': '图1',
      '其他.png': '图3',
    });
  });

  it('只选尺寸一致、可选、未配对且未被占用的效果图', () => {
    const candidates = [
      candidate('R0', 0, { pairedMask: { id: 'M', name: 'M', revision: 1 } }),
      candidate('R1', 1, { disabled: true }),
      candidate('R2', 2),
      candidate('R3', 3),
      candidate('R4', 4),
    ];
    expect(
      suggest([['a.png'], ['b.png', HD], ['c.png']], candidates, {
        sizes: { R4: HD },
        taken: ['R2'],
      }),
    ).toEqual({ 'a.png': 'R3', 'b.png': 'R4' });
  });

  it('指定的效果图优先分给第一个尺寸一致的文件', () => {
    const candidates = [candidate('R1', 0), candidate('R2', 1)];
    expect(
      suggest([['x.png', HD], ['y.png'], ['z.png']], candidates, {
        preferredId: 'R2',
      }),
    ).toEqual({ 'y.png': 'R2', 'z.png': 'R1' });
  });
});
