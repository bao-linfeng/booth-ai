import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRenderingCandidates } from '../rendering-candidates';

const state = vi.hoisted(() => ({ listSchemeAssetsApi: vi.fn() }));

vi.mock('#/api/core/assets', () => ({
  listSchemeAssetsApi: state.listSchemeAssetsApi,
}));

function rendering(id: string, width = 1920, height = 1080) {
  return { currentVersion: { heightPx: height, widthPx: width }, id, name: id };
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
  beforeEach(() => state.listSchemeAssetsApi.mockReset());

  it('只展示最后选择方案的效果图，先发后到的旧响应被忽略', async () => {
    const a = deferred<unknown[]>();
    const b = deferred<unknown[]>();
    state.listSchemeAssetsApi
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const candidates = useRenderingCandidates();

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
    expect(state.listSchemeAssetsApi.mock.calls).toEqual([
      ['A', 'rendering'],
      ['B', 'rendering'],
    ]);
  });

  it('重置（关闭弹窗）后旧请求的成功或失败都不改变候选与加载状态', async () => {
    const stale = deferred<unknown[]>();
    const failing = deferred<unknown[]>();
    const reopened = deferred<unknown[]>();
    state.listSchemeAssetsApi
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(failing.promise)
      .mockReturnValueOnce(reopened.promise);
    const candidates = useRenderingCandidates();

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
      { currentVersion: null, id: 'B-2', name: 'B-2' },
    ]);
    await flush();
    expect(candidates.options.value).toEqual([
      { disabled: false, label: 'B-1（1920×1080）', value: 'B-1' },
      { disabled: true, label: 'B-2（未上传文件）', value: 'B-2' },
    ]);
    expect(candidates.loading.value).toBe(false);
  });
});
