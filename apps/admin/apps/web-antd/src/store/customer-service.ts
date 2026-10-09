import type {
  ConversationCounts,
  ConversationTab,
  WorkbenchEvent,
} from '#/api/core/customer-service';

import { ref, watch } from 'vue';

import { useAccessStore, useUserStore } from '@vben/stores';

import { defineStore } from 'pinia';

import {
  listConversationsApi,
  openWorkbenchEvents,
  setPresenceApi,
} from '#/api/core/customer-service';

const PRESENCE_KEY = 'booth-admin:cs-presence';
const WORKBENCH_PATH = '/customer-service/workbench';
const MAX_FAILURES = 3;
/** 服务端每 15 秒发一次 ping；连续 45 秒收不到任何事件就视为断线（代理吞掉上游断开时浏览器收不到 error） */
export const STALE_MS = 45_000;

type Listener = (event: WorkbenchEvent) => void;

/** 客服工作台全局状态：事件流、在线状态、待接入数、提醒（标题、提示音、浏览器通知、菜单角标） */
export const useCustomerServiceStore = defineStore('customer-service', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const connected = ref(false);
  const presence = ref<'away' | 'online'>(
    sessionStorage.getItem(PRESENCE_KEY) === 'away' ? 'away' : 'online',
  );
  const counts = ref<ConversationCounts>({ mine: 0, offline: 0, queue: 0 });
  /** 工作台当前标签：页面切走会被卸载，记在常驻 store 里以便切回时恢复 */
  const workbenchTab = ref<ConversationTab>('queue');
  /** 未查看的提醒数，标签页重新可见后清零 */
  const unseen = ref(0);
  const listeners = new Set<Listener>();
  let source: EventSource | undefined;
  let failures = 0;
  let running = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let countsTimer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  /** 连接中断或建立失败过：下一次收到 ready 时需要通知页面全量校准 */
  let lost = false;
  let baseTitle = '';

  const canReply = () =>
    accessStore.accessCodes.includes('customer-service.reply');

  async function refreshCounts() {
    try {
      const page = await listConversationsApi({ tab: 'queue', pageSize: 1 });
      applyCounts(page.counts);
    } catch {
      // 轮询失败时保持上次计数
    }
  }

  function applyCounts(next: ConversationCounts) {
    // 以待接入数增加作为“新会话入队”提醒，不依赖事件类型
    if (next.queue > counts.value.queue) remind('有新的客户咨询等待接入');
    counts.value = next;
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify(event: WorkbenchEvent) {
    for (const listener of listeners) listener(event);
  }

  /** 降级轮询：计数之外也通知页面重拉列表、详情与消息 */
  async function poll() {
    await refreshCounts();
    notify({ counts: counts.value, type: 'ready' });
  }

  function handle(event: WorkbenchEvent) {
    if (event.type === 'ready') {
      // 首次连接只同步计数；重连后断线期间的事件已丢失，转给页面做一次全量校准
      if (lost) {
        lost = false;
        applyCounts(event.counts);
        notify(event);
      } else {
        counts.value = event.counts;
      }
      return;
    }
    // 只有客户发来的消息才提醒；客服回复、内部备注与系统消息不提醒，入队提醒见 applyCounts
    if (
      event.type === 'message.created' &&
      event.senderType === 'customer' &&
      event.agentAdminId === userStore.userInfo?.userId &&
      event.status === 'active'
    ) {
      remind('我的会话有新消息');
    }
    notify(event);
    clearTimeout(countsTimer);
    countsTimer = setTimeout(refreshCounts, 300);
  }

  function fail(next: EventSource) {
    next.close();
    if (source !== next) return;
    clearTimeout(staleTimer);
    source = undefined;
    connected.value = false;
    scheduleReconnect();
  }

  function arm(next: EventSource) {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => fail(next), STALE_MS);
  }

  async function connect() {
    if (!running) return;
    try {
      const next = await openWorkbenchEvents();
      if (!running) {
        next.close();
        return;
      }
      source = next;
      arm(next);
      next.addEventListener('ping', () => arm(next));
      next.addEventListener('update', (message) => {
        arm(next);
        try {
          handle(JSON.parse((message as MessageEvent<string>).data));
        } catch {
          // 忽略无法解析的事件
        }
      });
      next.addEventListener('open', () => {
        arm(next);
        connected.value = true;
        failures = 0;
        stopPolling();
      });
      next.addEventListener('error', () => fail(next));
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!running) return;
    lost = true;
    failures++;
    if (failures >= MAX_FAILURES) startPolling();
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, Math.min(3000 * failures, 30_000));
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, 10_000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  }

  async function setPresence(status: 'away' | 'online') {
    await setPresenceApi(status);
    presence.value = status;
    sessionStorage.setItem(PRESENCE_KEY, status);
  }

  function beep() {
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.4);
      oscillator.addEventListener('ended', () => context.close());
    } catch {
      // 浏览器未允许音频时静默
    }
  }

  function remind(text: string) {
    beep();
    if (document.visibilityState === 'hidden') {
      unseen.value++;
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('在线客服', {
          body: text,
          tag: 'booth-cs',
        });
        notification.addEventListener('click', () => window.focus());
      }
    }
  }

  /** 浏览器通知需在用户交互中申请授权（工作台首次点击时调用） */
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') unseen.value = 0;
  }

  watch(unseen, (count) => {
    const current = document.title.replace(/^\(\d+\) /, '');
    baseTitle = current;
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  });

  // 菜单角标：待接入数；菜单重新生成后重新标注
  function applyBadge() {
    const badge = counts.value.queue > 0 ? String(counts.value.queue) : '';
    let changed = false;
    const menus = accessStore.accessMenus.map(function mark(menu): typeof menu {
      const children = menu.children?.map((child) => mark(child));
      if (menu.path === WORKBENCH_PATH && (menu.badge ?? '') !== badge) {
        changed = true;
        return { ...menu, badge, badgeType: 'normal', children };
      }
      return children ? { ...menu, children } : menu;
    });
    if (changed) accessStore.setAccessMenus(menus);
  }
  watch(
    () => [counts.value.queue, accessStore.accessMenus] as const,
    applyBadge,
  );

  function start() {
    if (running) return;
    running = true;
    failures = 0;
    lost = false;
    document.addEventListener('visibilitychange', onVisibility);
    if (canReply()) void setPresenceApi(presence.value).catch(() => undefined);
    void refreshCounts();
    void connect();
  }

  function stop() {
    running = false;
    source?.close();
    source = undefined;
    connected.value = false;
    clearTimeout(reconnectTimer);
    clearTimeout(countsTimer);
    clearTimeout(staleTimer);
    stopPolling();
    document.removeEventListener('visibilitychange', onVisibility);
    unseen.value = 0;
    workbenchTab.value = 'queue';
  }

  return {
    connected,
    counts,
    presence,
    refreshCounts,
    requestNotificationPermission,
    setPresence,
    start,
    stop,
    subscribe,
    unseen,
    workbenchTab,
  };
});
