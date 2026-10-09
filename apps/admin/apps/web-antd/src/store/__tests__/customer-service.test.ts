import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STALE_MS, useCustomerServiceStore } from '../customer-service';

class FakeEventSource {
  closed = false;
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  addEventListener(type: string, listener: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    for (const listener of this.listeners[type] ?? [])
      listener({ data: JSON.stringify(data) });
  }
}

const state = vi.hoisted(() => ({ sources: [] as FakeEventSource[] }));

vi.mock('@vben/stores', () => ({
  useAccessStore: () => ({
    accessCodes: ['customer-service.read'],
    accessMenus: [],
    setAccessMenus: vi.fn(),
  }),
  useUserStore: () => ({ userInfo: { userId: 'agent-1' } }),
}));
vi.mock('#/api/core/customer-service', () => ({
  listConversationsApi: vi.fn(async () => ({
    counts: { mine: 0, offline: 0, queue: 0 },
  })),
  openWorkbenchEvents: vi.fn(async () => {
    const source = new FakeEventSource();
    state.sources.push(source);
    return source;
  }),
  setPresenceApi: vi.fn(async () => undefined),
}));

describe('customer service workbench stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    state.sources = [];
  });
  afterEach(() => {
    useCustomerServiceStore().stop();
    vi.useRealTimers();
  });

  it('drops a stream silent for 45 seconds and reconnects; pings keep it alive', async () => {
    const store = useCustomerServiceStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const [first] = state.sources;
    expect(first).toBeDefined();
    if (!first) throw new Error('source missing');
    first.emit('open');
    expect(store.connected).toBe(true);

    await vi.advanceTimersByTimeAsync(STALE_MS - 1);
    first.emit('ping', {});
    await vi.advanceTimersByTimeAsync(STALE_MS - 1);
    expect(first.closed).toBe(false);

    // 代理吞掉上游断开时浏览器收不到 error，只能靠看门狗发现
    await vi.advanceTimersByTimeAsync(1);
    expect(first.closed).toBe(true);
    expect(store.connected).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    expect(state.sources).toHaveLength(2);
  });

  it('forwards ready to listeners only after a reconnect so the page can resync', async () => {
    const store = useCustomerServiceStore();
    const events: string[] = [];
    store.subscribe((event) => events.push(event.type));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const [first] = state.sources;
    if (!first) throw new Error('source missing');
    first.emit('open');
    // 首次连接页面自己会加载，ready 只更新计数
    first.emit('update', {
      counts: { mine: 1, offline: 0, queue: 0 },
      type: 'ready',
    });
    expect(store.counts.mine).toBe(1);
    expect(events).toEqual([]);

    first.emit('error');
    await vi.advanceTimersByTimeAsync(3000);
    const second = state.sources[1];
    if (!second) throw new Error('reconnect missing');
    second.emit('open');
    second.emit('update', {
      counts: { mine: 2, offline: 0, queue: 0 },
      type: 'ready',
    });
    expect(store.counts.mine).toBe(2);
    expect(events).toEqual(['ready']);
  });

  it('asks the page to resync on every degraded poll', async () => {
    const store = useCustomerServiceStore();
    const events: string[] = [];
    store.subscribe((event) => events.push(event.type));
    store.start();
    // 连续断线进入降级轮询
    for (const delay of [0, 3000, 6000]) {
      await vi.advanceTimersByTimeAsync(delay);
      state.sources.at(-1)?.emit('error');
    }
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(['ready']);
  });

  it('reminds only for customer messages in my active conversations', async () => {
    const hidden = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    const store = useCustomerServiceStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const [source] = state.sources;
    if (!source) throw new Error('source missing');
    const message = (senderType: string, kind: string) => ({
      agentAdminId: 'agent-1',
      conversationId: 'c1',
      kind,
      senderType,
      seq: 1,
      status: 'active',
      type: 'message.created',
    });
    // 客服自己的回复、内部备注、接入等系统消息都不算客户新消息
    for (const [senderType, kind] of [
      ['agent', 'text'],
      ['agent', 'note'],
      ['system', 'event'],
    ] as const)
      source.emit('update', message(senderType, kind));
    expect(store.unseen).toBe(0);
    source.emit('update', message('customer', 'text'));
    expect(store.unseen).toBe(1);
    hidden.mockRestore();
  });

  it('remembers the workbench tab until the stream stops', () => {
    const store = useCustomerServiceStore();
    store.start();
    store.workbenchTab = 'mine';
    expect(store.workbenchTab).toBe('mine');
    // 退出登录或失去权限时回到默认标签，避免下一位用户沿用
    store.stop();
    expect(store.workbenchTab).toBe('queue');
  });
});
