import type { App, ComponentPublicInstance } from 'vue';

import { createApp, defineComponent, h, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UserDetailModal from '../UserDetailModal.vue';

interface GridOptions {
  gridOptions: {
    pagerConfig: { currentPage: number; pageSize: number };
    proxyConfig: {
      autoLoad: boolean;
      ajax: {
        query: (params: {
          page: { currentPage: number; pageSize: number };
        }) => Promise<{
          items: Array<{ id: string; note: string }>;
          total: number;
        }>;
      };
    };
  };
}

const apiMocks = vi.hoisted(() => ({
  getCreditTransactionsApi: vi.fn(),
  getUserCreditBalanceApi: vi.fn(),
  getUserDetailApi: vi.fn(),
}));

const gridState = vi.hoisted(() => ({
  instances: [] as Array<{
    mounted: boolean;
    queryCalls: Array<{ currentPage: number; pageSize: number }>;
  }>,
}));

const tabsContextKey = Symbol('tabs-context');

vi.mock('#/api/core/credits', () => apiMocks);
vi.mock('#/api/core/user-manage', () => apiMocks);
// 积分流水需要 credits.read；本用例覆盖有权限时的懒加载与分页
vi.mock('@vben/access', () => ({
  useAccess: () => ({ hasAccessByCodes: () => true }),
}));

vi.mock('@vben/common-ui', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    useVbenModal: () => {
      const modalApi = {
        open: vi.fn(),
        setState: vi.fn(),
      };
      const Modal = defineComponent((_, { slots }) => {
        return () => h('div', { class: 'modal-stub' }, slots.default?.());
      });
      return [Modal, modalApi];
    },
  };
});

vi.mock('ant-design-vue', async () => {
  const {
    defineComponent,
    getCurrentInstance,
    h,
    inject,
    provide,
    reactive,
    toRef,
    watch,
  } = await import('vue');

  const Tabs = defineComponent({
    props: { activeKey: { required: true, type: String } },
    emits: ['update:activeKey'],
    setup(props, { emit, slots }) {
      const visited = reactive(new Set<string>());
      watch(
        () => props.activeKey,
        (activeKey) => visited.add(activeKey),
        { immediate: true },
      );
      provide(tabsContextKey, {
        activeKey: toRef(props, 'activeKey'),
        visited,
      });

      return () =>
        h('div', { class: 'tabs-stub' }, [
          h(
            'button',
            {
              'data-tab': 'info',
              onClick: () => emit('update:activeKey', 'info'),
            },
            'info',
          ),
          h(
            'button',
            {
              'data-tab': 'credits',
              onClick: () => emit('update:activeKey', 'credits'),
            },
            'credits',
          ),
          slots.default?.(),
        ]);
    },
  });

  const TabPane = defineComponent({
    props: { tab: { required: true, type: String } },
    setup(_, { slots }) {
      const instance = getCurrentInstance();
      const paneKey = String(instance?.vnode.key);
      const context = inject<{
        activeKey: { value: string };
        visited: Set<string>;
      }>(tabsContextKey);

      return () => {
        if (!context?.visited.has(paneKey)) return null;
        return h(
          'div',
          {
            'data-pane': paneKey,
            style: {
              display: context.activeKey.value === paneKey ? undefined : 'none',
            },
          },
          slots.default?.(),
        );
      };
    },
  });

  const Passthrough = defineComponent((_, { slots }) => {
    return () => h('div', slots.default?.());
  });

  return {
    Descriptions: Passthrough,
    DescriptionsItem: Passthrough,
    TabPane,
    Tabs,
    Tag: Passthrough,
  };
});

vi.mock('#/adapter/vxe-table', async () => {
  const { defineComponent, h, onMounted, onUnmounted, ref } =
    await import('vue');

  return {
    useVbenVxeGrid: (options: GridOptions) => {
      let currentInstance:
        | undefined
        | {
            mounted: boolean;
            queryCalls: Array<{ currentPage: number; pageSize: number }>;
          };
      const reload = vi.fn(() => {
        if (!currentInstance?.mounted) {
          console.error(
            'Error occurred while reloading:',
            new Error('grid is not mounted'),
          );
        }
      });

      const Grid = defineComponent({
        setup(_, { slots }) {
          const instance = {
            mounted: false,
            queryCalls: [] as Array<{ currentPage: number; pageSize: number }>,
          };
          currentInstance = instance;
          gridState.instances.push(instance);
          const rows = ref<Array<{ id: string; note: string }>>([]);
          const total = ref(0);
          const currentPage = ref(
            options.gridOptions.pagerConfig.currentPage ?? 1,
          );

          const query = async (page = currentPage.value) => {
            currentPage.value = page;
            const pageSize = options.gridOptions.pagerConfig.pageSize;
            instance.queryCalls.push({ currentPage: page, pageSize });
            const result = await options.gridOptions.proxyConfig.ajax.query({
              page: { currentPage: page, pageSize },
            });
            rows.value = result.items;
            total.value = result.total;
          };

          onMounted(async () => {
            instance.mounted = true;
            if (options.gridOptions.proxyConfig.autoLoad) {
              await query();
            }
          });
          onUnmounted(() => {
            instance.mounted = false;
            if (currentInstance === instance) currentInstance = undefined;
          });

          return () =>
            h('div', { 'data-grid': '' }, [
              h(
                'button',
                {
                  'data-next-page': '',
                  onClick: () => query(currentPage.value + 1),
                },
                'next',
              ),
              h('span', { 'data-grid-total': '' }, String(total.value)),
              h(
                'ul',
                rows.value.map((row) =>
                  h('li', { 'data-row': row.id, key: row.id }, row.note),
                ),
              ),
              slots.default?.(),
            ]);
        },
      });

      return [
        Grid,
        {
          reload,
          setGridOptions: vi.fn(
            ({
              pagerConfig,
            }: {
              pagerConfig: Partial<GridOptions['gridOptions']['pagerConfig']>;
            }) => {
              Object.assign(options.gridOptions.pagerConfig, pagerConfig);
            },
          ),
          useStore: vi.fn(() => ({})),
        },
      ];
    },
  };
});

type DetailModal = ComponentPublicInstance & {
  open: (userId: string) => Promise<void>;
};

let activeApp: App | undefined;

const user = (id: string) => ({
  id,
  externalUserId: `external-${id}`,
  username: id,
  nickname: null,
  email: null,
  mobile: null,
  avatarPath: null,
  company: null,
  country: null,
  city: null,
  languageCode: null,
  enabled: true,
  roles: [],
  permissions: [],
  lastLoginAt: null,
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function flush() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountModal() {
  let modal: DetailModal | undefined;
  const Consumer = defineComponent(
    () => () =>
      h(UserDetailModal, {
        ref: (value) => {
          modal = value as DetailModal;
        },
      }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  activeApp = createApp(Consumer);
  activeApp.mount(host);
  await flush();
  if (!modal) throw new Error('detail modal was not exposed');
  return { host, modal };
}

beforeEach(() => {
  apiMocks.getUserDetailApi.mockImplementation(async (id: string) => user(id));
  apiMocks.getUserCreditBalanceApi.mockResolvedValue({ balance: 100 });
  apiMocks.getCreditTransactionsApi.mockImplementation(
    async ({
      page,
      pageSize,
      userId,
    }: {
      page: number;
      pageSize: number;
      userId: string;
    }) => ({
      data: [{ id: `${userId}-${page}`, note: `${userId}-page-${page}` }],
      total: userId === 'user-1' ? 21 : 3,
      page,
      pageSize,
    }),
  );
});

afterEach(() => {
  activeApp?.unmount();
  activeApp = undefined;
  document.body.innerHTML = '';
  gridState.instances.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('user detail modal credit transactions', () => {
  it('loads lazily, keeps the grid mounted across tabs, paginates, and resets for another user', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { host, modal } = await mountModal();

    await modal.open('user-1');
    expect(apiMocks.getCreditTransactionsApi).not.toHaveBeenCalled();
    expect(gridState.instances).toHaveLength(0);

    host.querySelector<HTMLButtonElement>('[data-tab="credits"]')?.click();
    await flush();

    expect(apiMocks.getCreditTransactionsApi).toHaveBeenCalledTimes(1);
    expect(apiMocks.getCreditTransactionsApi).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      userId: 'user-1',
    });
    expect(gridState.instances[0]?.queryCalls).toEqual([
      { currentPage: 1, pageSize: 10 },
    ]);
    expect(host.textContent).toContain('user-1-page-1');
    expect(host.querySelector('[data-grid-total]')?.textContent).toBe('21');

    host.querySelector<HTMLButtonElement>('[data-tab="info"]')?.click();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-tab="credits"]')?.click();
    await flush();
    expect(apiMocks.getCreditTransactionsApi).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('[data-next-page]')?.click();
    await flush();
    expect(apiMocks.getCreditTransactionsApi).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 10,
      userId: 'user-1',
    });
    expect(host.textContent).toContain('user-1-page-2');

    host.querySelector<HTMLButtonElement>('[data-tab="info"]')?.click();
    await flush();
    await modal.open('user-2');
    await flush();

    expect(host.textContent).not.toContain('user-1-page-2');

    host.querySelector<HTMLButtonElement>('[data-tab="credits"]')?.click();
    await flush();
    expect(apiMocks.getCreditTransactionsApi).toHaveBeenCalledTimes(3);
    expect(apiMocks.getCreditTransactionsApi).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 10,
      userId: 'user-2',
    });
    expect(gridState.instances).toHaveLength(2);
    expect(gridState.instances[1]?.queryCalls).toEqual([
      { currentPage: 1, pageSize: 10 },
    ]);
    expect(host.textContent).toContain('user-2-page-1');
    expect(host.querySelector('[data-grid-total]')?.textContent).toBe('3');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
