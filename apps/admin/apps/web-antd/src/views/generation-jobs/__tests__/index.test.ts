import type { App } from 'vue';

import type { GenerationJobDetail } from '#/api/core/generation-jobs';

import { createApp, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GenerationJobs from '../index.vue';

const api = vi.hoisted(() => ({
  getGenerationJobApi: vi.fn(),
  listGenerationJobsApi: vi.fn(),
}));

vi.mock('#/api/core/generation-jobs', () => api);
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@vben/utils', () => ({ formatDateTime: (value: string) => value }));
vi.mock('@vben/common-ui', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    Page: defineComponent(
      (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    ),
  };
});
vi.mock('#/adapter/vxe-table', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    useVbenVxeGrid: () => [
      defineComponent(
        (_, { slots }) =>
          () =>
            h(
              'div',
              ['task-A', 'task-B'].map((id) =>
                h('div', { 'data-row': id }, slots.action?.({ row: { id } })),
              ),
            ),
      ),
    ],
  };
});
vi.mock('ant-design-vue', async () => {
  const { defineComponent, h } = await import('vue');
  const Pass = defineComponent(
    (_, { slots }) =>
      () =>
        h('div', slots.default?.()),
  );
  return {
    Alert: Pass,
    Button: defineComponent(
      (_, { slots, attrs }) =>
        () =>
          h('button', attrs, slots.default?.()),
    ),
    Descriptions: Pass,
    DescriptionsItem: Pass,
    Drawer: defineComponent({
      props: { open: Boolean },
      emits: ['update:open'],
      setup(props, { slots, emit }) {
        return () =>
          props.open
            ? h('section', { 'data-drawer': '' }, [
                h(
                  'button',
                  {
                    'data-close': '',
                    onClick: () => emit('update:open', false),
                  },
                  '关闭',
                ),
                slots.default?.(),
              ])
            : null;
      },
    }),
    Image: Pass,
    Tag: Pass,
    Tooltip: Pass,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function detail(id: string): GenerationJobDetail {
  return {
    id,
    jobType: 'theme',
    status: 'succeeded',
    requestedCount: 1,
    usableCount: 1,
    input: {},
    credits: { reservation: null, charge: null },
    results: [],
  } as unknown as GenerationJobDetail;
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

let app: App;
let container: HTMLElement;
let errors: unknown[];

async function open(id: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-row="${id}"] button`,
  );
  if (!button) throw new Error(`Missing detail button for ${id}`);
  button.click();
  await flush();
}

async function close() {
  const button = container.querySelector<HTMLButtonElement>('[data-close]');
  if (!button) throw new Error('Missing drawer close button');
  button.click();
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  errors = [];
  container = document.createElement('div');
  document.body.append(container);
  app = createApp(GenerationJobs);
  app.directive('access', {});
  app.config.errorHandler = (error) => errors.push(error);
  app.mount(container);
});

afterEach(() => {
  app.unmount();
  container.remove();
});

describe('generation job detail requests', () => {
  it('keeps B loading when A returns after closing A and opening B', async () => {
    const a = deferred<GenerationJobDetail>();
    const b = deferred<GenerationJobDetail>();
    api.getGenerationJobApi
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    await open('task-A');
    await close();
    await open('task-B');
    expect(api.getGenerationJobApi.mock.calls).toEqual([
      ['task-A'],
      ['task-B'],
    ]);

    a.resolve(detail('task-A'));
    await flush();
    expect(container.textContent).toContain('加载中');
    expect(container.textContent).not.toContain('task-A');
    b.resolve(detail('task-B'));
    await flush();
    expect(container.textContent).toContain('task-B');
    expect(container.textContent).not.toContain('加载中');
  });

  it('does not overwrite B when A finishes last', async () => {
    const a = deferred<GenerationJobDetail>();
    const b = deferred<GenerationJobDetail>();
    api.getGenerationJobApi
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    await open('task-A');
    await close();
    await open('task-B');
    b.resolve(detail('task-B'));
    await flush();
    a.resolve(detail('task-A'));
    await flush();
    expect(container.textContent).toContain('task-B');
    expect(container.textContent).not.toContain('task-A');
  });

  it('leaves the detail empty when B fails and A returns afterwards', async () => {
    const a = deferred<GenerationJobDetail>();
    const b = deferred<GenerationJobDetail>();
    api.getGenerationJobApi
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    await open('task-A');
    await close();
    await open('task-B');
    b.reject(new Error('B failed'));
    await flush();
    a.resolve(detail('task-A'));
    await flush();
    expect(errors).toHaveLength(1);
    expect(container.textContent).not.toContain('加载中');
    expect(container.textContent).not.toContain('task-A');
    expect(container.textContent).not.toContain('task-B');
  });
});
