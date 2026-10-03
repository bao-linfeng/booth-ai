import type { ProjectNotification } from '#/api/core/project-notifications';

import { ref } from 'vue';

import { defineStore } from 'pinia';

import {
  listProjectNotificationsApi,
  markAllProjectNotificationsReadApi,
  markProjectNotificationReadApi,
} from '#/api/core/project-notifications';

const POPUP_SIZE = 10;
const MAX_FAILURES = 3;

/** 顶栏通知气泡：未读项目通知（最近 N 条）与未读总数，列表页变更后调用 refresh 同步 */
export const useNotificationStore = defineStore('project-notification', () => {
  const unread = ref<ProjectNotification[]>([]);
  const unreadCount = ref(0);
  /** 已读状态变更计数，列表页据此重新加载 */
  const version = ref(0);
  let failures = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    try {
      const res = await listProjectNotificationsApi({
        isRead: false,
        pageSize: POPUP_SIZE,
      });
      unread.value = res.items;
      unreadCount.value = res.unreadCount;
      failures = 0;
    } catch {
      // 连续失败后停止轮询，避免服务不可用时持续弹出错误提示
      if (++failures >= MAX_FAILURES) stop();
    }
  }

  async function markRead(id: string) {
    await markProjectNotificationReadApi(id);
    await reload();
  }

  async function markAllRead() {
    await markAllProjectNotificationsReadApi();
    await reload();
  }

  /** 已读状态已在服务端变更：刷新气泡并通知列表页 */
  async function reload() {
    version.value++;
    await refresh();
  }

  function start(intervalMs = 60_000) {
    stop();
    failures = 0;
    refresh();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return {
    markAllRead,
    markRead,
    refresh,
    reload,
    start,
    stop,
    unread,
    unreadCount,
    version,
  };
});
