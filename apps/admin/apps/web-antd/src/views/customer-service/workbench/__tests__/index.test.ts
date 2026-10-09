import type { App } from 'vue';

import type {
  AdminConversation,
  ConversationTab,
} from '#/api/core/customer-service';

import { createApp, defineComponent, h, reactive } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Workbench from '../index.vue';

const api = vi.hoisted(() => ({
  getConversationApi: vi.fn(),
  listConversationsApi: vi.fn(),
}));
/** 会话列表替身：渲染当前条目，并暴露切换页签与翻页的入口 */
const list = vi.hoisted(() => ({
  setPage: (_page: number) => {},
  setTab: (_tab: ConversationTab) => {},
}));

vi.mock('#/api/core/customer-service', () => api);
vi.mock('#/store', () => ({
  useCustomerServiceStore: () =>
    reactive({
      connected: true,
      counts: {},
      presence: 'online',
      requestNotificationPermission: vi.fn(),
      setPresence: vi.fn(),
      subscribe: () => () => {},
      workbenchTab: 'queue',
    }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@vben/access', () => ({
  useAccess: () => ({ hasAccessByCodes: () => true }),
}));
vi.mock('@vben/common-ui', async () => {
  const { defineComponent: define, h: render } = await import('vue');
  return {
    Page: define(
      (_, { slots }) =>
        () =>
          render('div', slots.default?.()),
    ),
  };
});
vi.mock('ant-design-vue', () => ({
  Badge: () => null,
  Switch: () => null,
  Tooltip: () => null,
}));
vi.mock('../components/ConversationList.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue');
  return {
    default: define({
      props: ['items'],
      emits: ['update:page', 'update:tab'],
      setup(props: { items: AdminConversation[] }, { emit }) {
        list.setPage = (page) => emit('update:page', page);
        list.setTab = (tab) => emit('update:tab', tab);
        return () =>
          render(
            'ul',
            props.items.map((item) => render('li', item.conversationNo)),
          );
      },
    }),
  };
});
vi.mock('../components/ConversationPanel.vue', () => ({ default: () => null }));
vi.mock('../components/ContextPanel.vue', () => ({ default: () => null }));
vi.mock('../components/TransferModal.vue', async () => {
  const { defineComponent: define } = await import('vue');
  return { default: define({ render: () => null }) };
});

interface ListResult {
  counts: Record<string, number>;
  items: AdminConversation[];
  total: number;
}

function result(no: string): ListResult {
  return {
    counts: {},
    items: [{ conversationNo: no, id: no } as AdminConversation],
    total: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

let app: App | undefined;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.listConversationsApi.mockResolvedValue(result('首屏'));
  container = document.createElement('div');
  document.body.append(container);
  app = createApp(defineComponent({ render: () => h(Workbench) }));
  app.mount(container);
});
afterEach(() => {
  app?.unmount();
  container.remove();
  app = undefined;
});

describe('workbench conversation list', () => {
  it('ignores a slow list response once a newer tab or page was requested', async () => {
    await flush();
    const mine = deferred<ListResult>();
    const second = deferred<ListResult>();
    api.listConversationsApi
      .mockReturnValueOnce(mine.promise)
      .mockReturnValueOnce(second.promise);

    list.setTab('mine');
    await flush();
    list.setPage(2);
    await flush();
    expect(api.listConversationsApi).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
      tab: 'mine',
    });

    second.resolve(result('我的第 2 页'));
    await flush();
    mine.resolve(result('我的第 1 页'));
    await flush();
    expect(container.textContent).toContain('我的第 2 页');
    expect(container.textContent).not.toContain('我的第 1 页');
  });
});
