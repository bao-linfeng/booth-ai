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
    resetForm: vi.fn(async () => {
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
    /** 与 Vben 一样按 fieldName 合并，componentProps 浅合并 */
    updateSchema: vi.fn((items: Partial<SchemaItem>[]) => {
      for (const item of items) {
        const current = state.schema.find(
          (schema) => schema.fieldName === item.fieldName,
        );
        if (!current) continue;
        Object.assign(current, {
          ...item,
          componentProps: {
            ...current.componentProps,
            ...item.componentProps,
          },
        });
      }
    }),
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
    DatePicker: define({
      props: { value: { type: String, default: undefined } },
      emits: ['update:value'],
      setup:
        (_, { emit }) =>
        () =>
          render('input', {
            'data-test': 'date-picker',
            onInput: (event: Event) =>
              emit('update:value', (event.target as HTMLInputElement).value),
          }),
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
    message: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
    /** 打开时渲染内容与确认按钮（文本取 okText），点击确认触发 ok */
    Modal: define({
      props: {
        okText: { type: String, default: '确定' },
        open: Boolean,
        title: { type: String, default: '' },
      },
      emits: ['ok', 'update:open'],
      setup:
        (props, { emit, slots }) =>
        () =>
          props.open
            ? render('div', { role: 'dialog' }, [
                props.title,
                slots.default?.(),
                render(
                  'button',
                  { type: 'button', onClick: () => emit('ok') },
                  props.okText,
                ),
              ])
            : null,
    }),
    /** 渲染原生 select，选择后与 ant-design-vue 一样触发 update:value 与 change（数字选项还原为数字） */
    Select: define({
      inheritAttrs: false,
      props: {
        disabled: Boolean,
        options: {
          type: Array as () => { label: string; value: number | string }[],
          default: () => [],
        },
        value: { type: [String, Number], default: undefined },
      },
      emits: ['change', 'update:value'],
      setup:
        (props, { attrs, emit }) =>
        () =>
          render(
            'select',
            {
              'data-test': attrs['data-test'],
              disabled: props.disabled,
              onChange: (event: Event) => {
                const raw = (event.target as HTMLSelectElement).value;
                const option = props.options.find(
                  (item) => String(item.value) === raw,
                );
                emit('update:value', option?.value);
                emit('change', option?.value);
              },
            },
            [
              render('option', { value: '' }),
              ...props.options.map((option) =>
                render('option', { value: String(option.value) }, option.label),
              ),
            ],
          ),
    }),
    /** 按 columns 逐行渲染 bodyCell 插槽，行的 class 取 rowClassName */
    Table: define({
      props: {
        columns: { type: Array as () => { key?: string }[], default: () => [] },
        dataSource: { type: Array, default: () => [] },
        rowClassName: {
          type: Function as unknown as () => (record: unknown) => string,
          default: undefined,
        },
      },
      setup:
        (props, { slots }) =>
        () =>
          render(
            'table',
            { 'data-rows': props.dataSource.length },
            props.dataSource.map((record) =>
              render(
                'tr',
                { class: props.rowClassName?.(record), 'data-test': 'row' },
                props.columns.map((column) =>
                  render('td', slots.bodyCell?.({ column, record })),
                ),
              ),
            ),
          ),
    }),
    Tag: passthrough,
    Tooltip: passthrough,
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
