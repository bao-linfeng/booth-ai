import type { Ref } from 'vue';
import type { LocationQuery } from 'vue-router';

import type { SchemeRecord } from '#/api/core/schemes';

import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { debounce } from '@vben/utils';

import { getSchemeListApi } from '#/api/core/schemes';

export interface SchemeOption {
  label: string;
  value: string;
}

/** 资源列表检索表单的值 */
export interface SchemeFilterValues {
  schemeCode?: string;
}

function toOption(item: Pick<SchemeRecord, 'code' | 'name'>): SchemeOption {
  return { label: `${item.code} - ${item.name}`, value: item.code };
}

/** 读取路由上的归属方案编号；重复参数取第一个，空值视为未指定。 */
export function readRouteSchemeCode(query: LocationQuery): string | undefined {
  const raw = query.schemeCode;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

/**
 * 归属方案下拉选项：按编号关键字搜索前 20 条。
 * `pin` 指定的方案即使不在搜索结果中也保留在选项里，已选值才能显示名称而不只是编号；
 * 只采用最后一次搜索的响应。
 */
export function useSchemeOptions() {
  const options = ref<SchemeOption[]>([]);
  const loading = ref(false);
  let pinned: SchemeOption | undefined;
  let sequence = 0;

  function withPinned(list: SchemeOption[]) {
    const current = pinned;
    if (!current || list.some((item) => item.value === current.value)) {
      return list;
    }
    return [current, ...list];
  }

  async function search(keyword?: string) {
    const current = ++sequence;
    loading.value = true;
    try {
      const res = await getSchemeListApi({
        ...(keyword ? { code: keyword } : {}),
        pageSize: 20,
      });
      if (current !== sequence) return;
      options.value = withPinned(
        (res.data ?? []).map((item) => toOption(item)),
      );
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  async function pin(code?: string) {
    pinned = code ? { label: code, value: code } : undefined;
    if (!code) return;
    options.value = withPinned(options.value);
    try {
      const res = await getSchemeListApi({ code, pageSize: 20 });
      const match = res.data?.find((item) => item.code === code);
      if (!match || pinned?.value !== code) return;
      const option = toOption(match);
      pinned = option;
      options.value = options.value.map((item) =>
        item.value === code ? option : item,
      );
    } catch {
      // 查不到名称时保留以编号展示的选项
    }
  }

  function clear() {
    sequence++;
    pinned = undefined;
    options.value = [];
    loading.value = false;
  }

  const onSearch = debounce((value: string) => {
    search(value || undefined);
  }, 300);

  return { clear, loading, onSearch, options, pin, search };
}

/** 资源列表检索区：归属方案下拉，默认值为进入页面时路由指定的方案。 */
export function createSchemeFilterFormOptions(config: {
  defaultSchemeCode?: string;
  loading: Ref<boolean>;
  onSearch: (value: string) => void;
  options: Ref<SchemeOption[]>;
}) {
  return {
    schema: [
      {
        component: 'Select' as const,
        fieldName: 'schemeCode',
        label: '归属方案',
        ...(config.defaultSchemeCode
          ? { defaultValue: config.defaultSchemeCode }
          : {}),
        componentProps: {
          options: config.options,
          loading: config.loading,
          showSearch: true,
          filterOption: false,
          allowClear: true,
          placeholder: '搜索方案编号或名称',
          onSearch: config.onSearch,
        },
      },
    ],
    showCollapseButton: false,
  };
}

/**
 * 跟随本页路由的 `?schemeCode=`：返回进入页面时的方案编号，供首轮查询前写入筛选默认值；
 * 之后本页路由上的编号变化时回调 `onChange`。页面被 KeepAlive 缓存期间，
 * 其他页面的路由变化不会触发回调，也不会覆盖用户在本页手动改过的筛选。
 */
export function useRouteSchemeCode(
  onChange: (code: string | undefined) => void,
) {
  const route = useRoute();
  const path = route.path;
  let applied = readRouteSchemeCode(route.query);
  const initial = applied;

  watch(
    () => [route.path, readRouteSchemeCode(route.query)] as const,
    ([currentPath, code]) => {
      if (currentPath !== path || code === applied) return;
      applied = code;
      onChange(code);
    },
  );

  return initial;
}
