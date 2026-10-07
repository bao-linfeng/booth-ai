import type { Component } from 'vue';

import { defineComponent, h } from 'vue';

import { vi } from 'vitest';

type Values = Record<string, unknown>;
interface FormOptions {
  handleSubmit?: (values: Values) => Promise<void> | void;
  handleValuesChange?: (values: Values, fields: string[]) => void;
  schema?: SchemaItem[];
}
export interface SchemaItem {
  componentProps?: Record<string, unknown>;
  dependencies?: {
    resolve: (context: { values: Values }) => Record<string, unknown>;
  };
  fieldName: string;
  help?: string;
  label?: string;
  rules?: string;
}

/**
 * useVbenForm 的内存替身：保留 handleSubmit / handleValuesChange / schema / commonConfig 这些业务组件真正依赖的契约，
 * 不渲染表单控件。`edit` 模拟用户输入（触发 handleValuesChange），`setValues` 与 Vben 一样同样会触发。
 */
export function createFakeForm() {
  const state = {
    commonConfig: {} as Record<string, unknown>,
    options: {} as FormOptions,
    schema: [] as SchemaItem[],
    values: {} as Values,
  };
  const api = {
    getValues: vi.fn(async () => ({ ...state.values })),
    reset: vi.fn(async () => {
      state.values = {};
    }),
    setFieldValue: vi.fn(async (field: string, value: unknown) => {
      state.values[field] = value;
    }),
    setState: vi.fn(
      (next: {
        commonConfig?: Record<string, unknown>;
        schema?: SchemaItem[];
      }) => {
        if (next.schema) state.schema = next.schema;
        if (next.commonConfig) state.commonConfig = next.commonConfig;
      },
    ),
    setValues: vi.fn(async (values: Values) => {
      Object.assign(state.values, values);
      state.options.handleValuesChange?.(state.values, Object.keys(values));
    }),
    validateAndSubmitForm: vi.fn(async () => {
      await state.options.handleSubmit?.({ ...state.values });
    }),
  };
  const field = (name: string) => {
    const item = state.schema.find((schema) => schema.fieldName === name);
    if (!item) throw new Error(`Missing schema field: ${name}`);
    return item;
  };
  return {
    api,
    state,
    field,
    options: (name: string) => field(name).componentProps?.options,
    edit(values: Values) {
      Object.assign(state.values, values);
      state.options.handleValuesChange?.(state.values, Object.keys(values));
    },
    /** 按当前值求 dependencies.resolve，未声明依赖的字段视为始终显示 */
    resolved(name: string) {
      return (
        field(name).dependencies?.resolve({ values: state.values }) ?? {
          show: true,
        }
      );
    },
    useVbenForm(options: FormOptions): [Component, typeof api] {
      state.options = options;
      state.schema = options.schema ?? [];
      state.values = {};
      state.commonConfig = {};
      return [defineComponent(() => () => h('form')), api];
    },
  };
}

export function createFakeModal() {
  const state = {
    open: false,
    options: {} as { onCancel?: () => void; onConfirm?: () => Promise<void> },
    title: '',
  };
  const api = {
    close: vi.fn(() => {
      state.open = false;
    }),
    open: vi.fn(() => {
      state.open = true;
    }),
    setState: vi.fn((next: { title?: string }) => {
      if (next.title) state.title = next.title;
    }),
  };
  return {
    api,
    state,
    confirm: () => state.options.onConfirm?.(),
    useVbenModal(options: typeof state.options): [Component, typeof api] {
      state.options = options;
      return [
        defineComponent(
          (_, { slots }) =>
            () =>
              h('div', slots.default?.()),
        ),
        api,
      ];
    },
  };
}

/** ant-design-vue 的最小替身：Button 渲染原生按钮并保留 disabled，其余只透传插槽。 */
export async function fakeAntd() {
  const { defineComponent: define, h: render } = await import('vue');
  const passthrough = define(
    (_, { slots }) =>
      () =>
        render('div', slots.default?.()),
  );
  return {
    Alert: define({
      props: { message: { type: String, default: '' } },
      setup:
        (props, { slots }) =>
        () =>
          render('div', { role: 'alert' }, [props.message, slots.action?.()]),
    }),
    Button: define({
      props: { disabled: Boolean, loading: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          render(
            'button',
            { disabled: props.disabled || props.loading, type: 'button' },
            slots.default?.(),
          ),
    }),
    Card: define({
      setup:
        (_, { slots }) =>
        () =>
          render('div', [slots.default?.(), slots.extra?.()]),
    }),
    Input: passthrough,
    InputNumber: define({
      props: { value: { type: Number, default: undefined } },
      emits: ['update:value'],
      setup:
        (_, { emit }) =>
        () =>
          render('input', {
            'data-test': 'history',
            onInput: (event: Event) =>
              emit(
                'update:value',
                Number((event.target as HTMLInputElement).value),
              ),
          }),
    }),
    message: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
    Select: passthrough,
    Table: define({
      props: { dataSource: { type: Array, default: () => [] } },
      setup: (props) => () =>
        render('table', { 'data-rows': props.dataSource.length }),
    }),
    Tag: passthrough,
  };
}

export function button(root: Element, text: string) {
  const found = [...root.querySelectorAll('button')].find((element) =>
    element.textContent?.trim().startsWith(text),
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}

export async function flush() {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
}
