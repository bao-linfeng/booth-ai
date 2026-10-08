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
});
