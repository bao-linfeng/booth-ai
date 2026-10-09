import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderingCandidate,
  useRenderingCandidates,
} from '../rendering-candidates';

const state = vi.hoisted(() => ({ listMaskPairingCandidatesApi: vi.fn() }));

vi.mock('#/api/core/assets', () => ({
  listMaskPairingCandidatesApi: state.listMaskPairingCandidatesApi,
}));

function rendering(id: string, width = 1920, height = 1080) {
  return {
    file: { heightPx: height, originalFilename: `${id}.png`, widthPx: width },
    id,
    name: id,
    pairedMask: null,
    sortOrder: 0,
    thumbnailUrl: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('useRenderingCandidates', () => {
  beforeEach(() => state.listMaskPairingCandidatesApi.mockReset());

  it('只展示最后选择方案的效果图，先发后到的旧响应被忽略', async () => {
    const a = deferred<unknown[]>();
    const b = deferred<unknown[]>();
    state.listMaskPairingCandidatesApi
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const candidates = useRenderingCandidates(() => true);

    candidates.load('A');
    candidates.load('B');
    b.resolve([rendering('B-1')]);
    await flush();
    expect(candidates.options.value.map((item) => item.value)).toEqual(['B-1']);
    expect(candidates.loading.value).toBe(false);

    a.resolve([rendering('A-1', 1600, 900)]);
    await flush();
    expect(candidates.options.value.map((item) => item.value)).toEqual(['B-1']);
    expect(candidates.sizeOf('A-1')).toBeNull();
    expect(candidates.sizeOf('B-1')).toEqual({ height: 1080, width: 1920 });
    expect(state.listMaskPairingCandidatesApi.mock.calls).toEqual([
      ['A'],
      ['B'],
    ]);
  });

  it('重置（关闭弹窗）后旧请求的成功或失败都不改变候选与加载状态', async () => {
    const stale = deferred<unknown[]>();
    const failing = deferred<unknown[]>();
    const reopened = deferred<unknown[]>();
    state.listMaskPairingCandidatesApi
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(failing.promise)
      .mockReturnValueOnce(reopened.promise);
    const candidates = useRenderingCandidates(() => true);

    candidates.load('A');
    candidates.reset();
    stale.resolve([rendering('A-1')]);
    await flush();
    expect(candidates.options.value).toEqual([]);
    expect(candidates.loading.value).toBe(false);

    candidates.load('A');
    candidates.reset();
    candidates.load('B');
    failing.reject(new Error('network'));
    await flush();
    expect(candidates.loading.value).toBe(true);

    reopened.resolve([
      rendering('B-1'),
      { ...rendering('B-2'), file: null, sortOrder: 1 },
    ]);
    await flush();
    expect(
      candidates.options.value.map(({ disabled, label, value }) => ({
        disabled,
        label,
        value,
      })),
    ).toEqual([
      { disabled: false, label: '#1 B-1（1920×1080）', value: 'B-1' },
      { disabled: true, label: '#2 B-2（未上传文件）', value: 'B-2' },
    ]);
    expect(candidates.loading.value).toBe(false);
  });
});

describe('renderingCandidate', () => {
  const paired = {
    ...rendering('R-1', 1600, 900),
    pairedMask: { id: 'M-1', name: '蒙版一', revision: 3 },
    sortOrder: 2,
    thumbnailUrl: 'https://cdn.test/r1.png',
  };

  it('shows thumbnail, file name, size and order for identification', () => {
    expect(renderingCandidate(rendering('R-2', 1600, 900), true)).toEqual({
      disabled: false,
      filename: 'R-2.png',
      label: '#1 R-2（1600×900）',
      pairedMask: null,
      sizeText: '1600×900',
      sortOrder: 0,
      status: '可配对',
      thumbnailUrl: null,
      value: 'R-2',
    });
  });

  it('offers occupied renderings only as a replacement of the existing mask', () => {
    expect(renderingCandidate(paired, true)).toMatchObject({
      disabled: false,
      pairedMask: { id: 'M-1', revision: 3 },
      status: '已配对「蒙版一」，选择后替换其文件',
      thumbnailUrl: 'https://cdn.test/r1.png',
    });
    expect(renderingCandidate(paired, false)).toMatchObject({
      disabled: true,
      status: '已配对「蒙版一」',
    });
  });
});
