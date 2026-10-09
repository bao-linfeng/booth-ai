import type { App } from 'vue';

import type {
  AdminConversation,
  AdminMessage,
  ConversationDetail,
  WorkbenchEvent,
} from '#/api/core/customer-service';

import { createApp, h, reactive } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationPanel from '../ConversationPanel.vue';

const api = vi.hoisted(() => ({
  claimConversationApi: vi.fn(),
  closeConversationApi: vi.fn(),
  listMessagesApi: vi.fn(),
  markReadApi: vi.fn(),
  postMessageApi: vi.fn(),
  releaseConversationApi: vi.fn(),
}));

vi.mock('#/api/core/customer-service', () => ({
  ...api,
  CS_LOCALE_LABELS: { en: '英语', zh: '中文' },
  STATUS_LABELS: { active: '进行中', closed: '已结束', queued: '排队中' },
  customerLabel: (conversation: AdminConversation) => conversation.id,
  eventText: () => '',
  schemeCardCoverUrl: () => '',
}));
vi.mock('#/api/core/projects', () => ({ statusLabels: {} }));
vi.mock('@vben/icons', () => ({ IconifyIcon: () => null }));
vi.mock('@vben/stores', () => ({
  useUserStore: () => ({ userInfo: { userId: 'admin-1' } }),
}));
vi.mock('@vben/utils', () => ({ formatDateTime: (value: string) => value }));
vi.mock('ant-design-vue', async () => {
  const { defineComponent, h: render } = await import('vue');
  const passthrough = defineComponent(
    (_, { slots }) =>
      () =>
        render('div', slots.default?.()),
  );
  const Button = defineComponent({
    props: { disabled: Boolean, loading: Boolean },
    emits: ['click'],
    setup:
      (props, { emit, slots }) =>
      () =>
        render(
          'button',
          {
            disabled: props.disabled || props.loading,
            onClick: () => emit('click'),
            type: 'button',
          },
          slots.default?.(),
        ),
  });
  const TextArea = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    setup:
      (props, { emit }) =>
      () =>
        render('textarea', {
          onInput: (event: Event) =>
            emit('update:value', (event.target as HTMLTextAreaElement).value),
          value: props.value,
        }),
  });
  return {
    Button,
    Empty: passthrough,
    Image: passthrough,
    Input: { TextArea },
    Modal: { confirm: vi.fn() },
    Radio: { Button: passthrough, Group: passthrough },
    Space: passthrough,
    Tag: passthrough,
    message: { success: vi.fn() },
  };
});

function conversation(id: string): ConversationDetail {
  return {
    contexts: [],
    conversation: {
      agentAdminId: 'admin-1',
      agentReadSeq: 0,
      conversationNo: `CS-${id}`,
      customerLocale: 'en',
      id,
      status: 'active',
    } as AdminConversation,
    history: [],
    projects: [],
  };
}

function message(conversationId: string, seq: number, body: string) {
  return {
    body,
    clientMessageId: null,
    context: null,
    conversationId,
    conversationNo: `CS-${conversationId}`,
    createdAt: '2026-10-09T00:00:00Z',
    eventCode: null,
    eventParams: null,
    id: `${conversationId}-${seq}`,
    kind: 'text',
    locale: 'en',
    senderAdminId: null,
    senderName: null,
    senderType: 'customer',
    seq,
    translations: [],
    visibility: 'public',
  } as AdminMessage;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function flush() {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

let app: App | undefined;
let container: HTMLElement;
const state = reactive<{
  canReply: boolean;
  detail: ConversationDetail | null;
  event: null | { event: WorkbenchEvent; version: number };
  supervise: boolean;
}>({ canReply: true, detail: null, event: null, supervise: false });

async function mount(id: string) {
  state.detail = conversation(id);
  container = document.createElement('div');
  document.body.append(container);
  app = createApp({ render: () => h(ConversationPanel, state) });
  app.mount(container);
  await flush();
}
async function open(id: string) {
  state.detail = conversation(id);
  await flush();
}
function text() {
  return container.textContent ?? '';
}
function textarea() {
  const found = container.querySelector('textarea');
  if (!found) throw new Error('Composer not rendered');
  return found;
}
async function type(value: string) {
  const input = textarea();
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await flush();
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

/** 首屏：A、B 各自只有一条客户消息；A 有更早的历史 */
function serveInitialPages() {
  api.listMessagesApi.mockImplementation(
    async (id: string, params: { after?: number; before?: number }) => {
      if (params.after === undefined && params.before === undefined) {
        return {
          hasMore: id === 'A',
          items: [message(id, 10, `${id} 首屏消息`)],
        };
      }
      return { hasMore: false, items: [] };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.detail = null;
  state.event = null;
  api.markReadApi.mockResolvedValue(undefined);
  serveInitialPages();
  let key = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-00000000000${++key}` as const,
  );
});
afterEach(() => {
  app?.unmount();
  container.remove();
  app = undefined;
});

describe('conversation panel switching', () => {
  it('drops a slow send response from A after switching to B', async () => {
    const response = deferred<{ message: AdminMessage }>();
    api.postMessageApi.mockReturnValue(response.promise);
    await mount('A');
    await type('A 的回复');
    button('发送').click();
    await flush();
    expect(text()).toContain('发送中');

    await open('B');
    expect(text()).toContain('B 首屏消息');
    expect(text()).not.toContain('A 的回复');

    response.resolve({ message: message('A', 11, 'A 的回复') });
    await flush();
    expect(text()).toContain('B 首屏消息');
    expect(text()).not.toContain('A 的回复');
    expect(text()).not.toContain('A 首屏消息');
  });

  it('drops slow history from A after switching to B', async () => {
    await mount('A');
    const older = deferred<{ hasMore: boolean; items: AdminMessage[] }>();
    api.listMessagesApi.mockImplementationOnce(() => older.promise);
    button('加载更早的消息').click();
    await flush();
    serveInitialPages();

    await open('B');
    older.resolve({ hasMore: false, items: [message('A', 9, 'A 历史消息')] });
    await flush();
    expect(text()).toContain('B 首屏消息');
    expect(text()).not.toContain('A 历史消息');
  });

  it('drops a slow translated message from A after switching to B', async () => {
    await mount('A');
    const translated = deferred<{ hasMore: boolean; items: AdminMessage[] }>();
    api.listMessagesApi.mockImplementationOnce(() => translated.promise);
    state.event = {
      event: {
        conversationId: 'A',
        seq: 10,
        type: 'message.translated',
      } as WorkbenchEvent,
      version: 1,
    };
    await flush();
    serveInitialPages();

    await open('B');
    translated.resolve({
      hasMore: false,
      items: [message('A', 10, 'A 译文更新')],
    });
    await flush();
    expect(text()).toContain('B 首屏消息');
    expect(text()).not.toContain('A 译文更新');
  });

  it('keeps drafts and failed sends per conversation', async () => {
    api.postMessageApi.mockRejectedValueOnce(new Error('network'));
    await mount('A');
    await type('A 的重试消息');
    button('发送').click();
    await flush();
    await type('A 的草稿');
    expect(text()).toContain('发送失败');

    await open('B');
    expect(textarea().value).toBe('');
    expect(text()).not.toContain('A 的重试消息');
    await type('B 的草稿');

    await open('A');
    expect(textarea().value).toBe('A 的草稿');
    expect(text()).toContain('A 的重试消息');

    api.postMessageApi.mockResolvedValueOnce({
      message: message('A', 11, 'A 的重试消息'),
    });
    button('重试').click();
    await flush();
    expect(api.postMessageApi).toHaveBeenLastCalledWith('A', {
      body: 'A 的重试消息',
      clientMessageId: '00000000-0000-4000-8000-000000000001',
      kind: 'text',
    });
    expect(text()).not.toContain('发送失败');
    expect(text()).toContain('A 的重试消息');

    await open('B');
    expect(textarea().value).toBe('B 的草稿');
  });
});

describe('conversation panel read reporting', () => {
  let hidden = false;
  beforeEach(() => {
    hidden = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      hidden ? 'hidden' : 'visible',
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('only reports read while the page is visible and catches up when it returns', async () => {
    await mount('A');
    expect(api.markReadApi).toHaveBeenLastCalledWith('A', 10);

    hidden = true;
    api.markReadApi.mockClear();
    api.listMessagesApi.mockResolvedValueOnce({
      hasMore: false,
      items: [message('A', 11, 'A 后台消息')],
    });
    state.event = {
      event: { conversationId: 'A', type: 'message.created' } as WorkbenchEvent,
      version: 1,
    };
    await flush();
    expect(text()).toContain('A 后台消息');
    expect(api.markReadApi).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.markReadApi).toHaveBeenCalledWith('A', 11);
  });

  it('does not report read for a conversation opened in a background tab', async () => {
    hidden = true;
    await mount('A');
    expect(text()).toContain('A 首屏消息');
    expect(api.markReadApi).not.toHaveBeenCalled();
  });
});
