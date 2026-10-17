import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomerServiceStore } from '../customer-service';
import { useNotificationStore } from '../notification';

vi.mock('@vben/stores', () => ({
  useAccessStore: () => ({
    accessCodes: [],
    accessMenus: [],
    setAccessMenus: vi.fn(),
  }),
  useUserStore: () => ({ userInfo: null }),
}));
vi.mock('#/api/core/customer-service', () => ({
  listConversationsApi: vi.fn(async () => ({
    counts: { mine: 1, offline: 0, queue: 2 },
  })),
  openWorkbenchEvents: vi.fn(async () => ({
    addEventListener: vi.fn(),
    close: vi.fn(),
  })),
  setPresenceApi: vi.fn(async () => undefined),
}));
vi.mock('#/api/core/project-notifications', () => ({
  listProjectNotificationsApi: vi.fn(async () => ({
    items: [{ id: 'n1' }],
    unreadCount: 1,
  })),
  markAllProjectNotificationsReadApi: vi.fn(),
  markProjectNotificationReadApi: vi.fn(),
}));

// 退出登录时 resetAllStores 会对每个 store 调 $reset，setup store 缺失时 Pinia 开发模式抛错，登出流程中断、不跳登录页
describe('store reset on logout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sessionStorage.clear();
  });

  it('customer service store stops the stream and clears agent state', async () => {
    const store = useCustomerServiceStore();
    await store.setPresence('away');
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.counts.queue).toBe(2);

    store.$reset();

    expect(store.counts).toEqual({ mine: 0, offline: 0, queue: 0 });
    expect(store.presence).toBe('online');
    expect(sessionStorage.getItem('booth-admin:cs-presence')).toBeNull();
    expect(store.connected).toBe(false);
  });

  it('notification store stops polling and clears unread items', async () => {
    const store = useNotificationStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.unreadCount).toBe(1);

    store.$reset();

    expect(store.unread).toEqual([]);
    expect(store.unreadCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
