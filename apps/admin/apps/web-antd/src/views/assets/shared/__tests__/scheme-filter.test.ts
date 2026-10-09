import type { EffectScope } from 'vue';
import type { LocationQuery } from 'vue-router';

import { effectScope, nextTick, reactive } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSchemeFilterFormOptions,
  readRouteSchemeCode,
  useRouteSchemeCode,
  useSchemeOptions,
} from '../scheme-filter';

const state = vi.hoisted(() => ({
  getSchemeListApi: vi.fn(),
  route: { path: '', query: {} } as { path: string; query: LocationQuery },
}));

vi.mock('vue-router', () => ({ useRoute: () => state.route }));
vi.mock('@vben/utils', () => ({ debounce: (fn: unknown) => fn }));
vi.mock('#/api/core/schemes', () => ({
  getSchemeListApi: state.getSchemeListApi,
}));

function schemes(...codes: string[]) {
  return { data: codes.map((code) => ({ code, name: `${code}名称` })) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let scope: EffectScope;

beforeEach(() => {
  scope = effectScope();
  state.getSchemeListApi.mockReset();
  state.route = reactive({
    path: '/assets/renderings',
    query: { schemeCode: 'A' },
  });
});

afterEach(() => {
  scope.stop();
});

describe('readRouteSchemeCode', () => {
  it('取第一个非空编号', () => {
    expect(readRouteSchemeCode({ schemeCode: 'A&B#1' })).toBe('A&B#1');
    expect(readRouteSchemeCode({ schemeCode: ['B', 'C'] })).toBe('B');
    expect(readRouteSchemeCode({ schemeCode: '  ' })).toBeUndefined();
    expect(readRouteSchemeCode({ schemeCode: [null] })).toBeUndefined();
    expect(readRouteSchemeCode({})).toBeUndefined();
  });
});

describe('createSchemeFilterFormOptions', () => {
  it('只在路由指定方案时设置筛选默认值', () => {
    const config = {
      loading: { value: false },
      onSearch: vi.fn(),
      options: { value: [] },
    } as unknown as Parameters<typeof createSchemeFilterFormOptions>[0];
    expect(
      createSchemeFilterFormOptions({ ...config, defaultSchemeCode: 'A' })
        .schema[0],
    ).toMatchObject({ defaultValue: 'A', fieldName: 'schemeCode' });
    expect(createSchemeFilterFormOptions(config).schema[0]).not.toHaveProperty(
      'defaultValue',
    );
  });
});

describe('useSchemeOptions', () => {
  it('已选方案不在搜索结果中时仍保留并显示名称', async () => {
    state.getSchemeListApi.mockImplementation(async ({ code }) =>
      code === 'A' ? schemes('A', 'A1') : schemes('B', 'C'),
    );
    const { options, pin, search } = useSchemeOptions();

    pin('A');
    expect(options.value).toEqual([{ label: 'A', value: 'A' }]);
    await search();
    await flush();

    expect(options.value).toEqual([
      { label: 'A - A名称', value: 'A' },
      { label: 'B - B名称', value: 'B' },
      { label: 'C - C名称', value: 'C' },
    ]);
  });

  it('只采用最后一次搜索的响应', async () => {
    const slow = deferred<ReturnType<typeof schemes>>();
    state.getSchemeListApi
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(schemes('B'));
    const { loading, options, search } = useSchemeOptions();

    const first = search('A');
    await search('B');
    slow.resolve(schemes('A'));
    await first;

    expect(options.value.map((item) => item.value)).toEqual(['B']);
    expect(loading.value).toBe(false);
  });

  it('清空后不再保留已选方案', async () => {
    state.getSchemeListApi.mockResolvedValue(schemes('B'));
    const { clear, options, pin, search } = useSchemeOptions();

    pin('A');
    clear();
    await search();

    expect(options.value.map((item) => item.value)).toEqual(['B']);
  });
});

describe('useRouteSchemeCode', () => {
  it('返回进入时的方案，只在本页路由的编号变化时回调', async () => {
    const onChange = vi.fn();
    const initial = scope.run(() => useRouteSchemeCode(onChange));
    expect(initial).toBe('A');

    // KeepAlive 缓存期间切到其他页面
    state.route.path = '/scheme/detail/B';
    state.route.query = {};
    await nextTick();
    expect(onChange).not.toHaveBeenCalled();

    // 浏览器后退回到同一方案：不覆盖本页已有筛选
    state.route.path = '/assets/renderings';
    state.route.query = { schemeCode: 'A' };
    await nextTick();
    expect(onChange).not.toHaveBeenCalled();

    state.route.query = { schemeCode: 'B' };
    await nextTick();
    expect(onChange).toHaveBeenLastCalledWith('B');

    state.route.query = {};
    await nextTick();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
