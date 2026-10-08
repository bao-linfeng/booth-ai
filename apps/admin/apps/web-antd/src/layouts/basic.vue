<script lang="ts" setup>
import type { NotificationItem } from '@vben/layouts';

import type { ProjectNotification } from '#/api/core/project-notifications';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationLoginExpiredModal } from '@vben/common-ui';
import { useWatermark } from '@vben/hooks';
import {
  BasicLayout,
  LockScreen,
  Notification,
  UserDropdown,
} from '@vben/layouts';
import { preferences, usePreferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';
import { formatDateTime } from '@vben/utils';

import {
  notificationSummary,
  notificationTitle,
} from '#/api/core/project-notifications';
import { $t } from '#/locales';
import {
  useAuthStore,
  useCustomerServiceStore,
  useNotificationStore,
} from '#/store';
import LoginForm from '#/views/_core/authentication/login.vue';
import NotificationDetailModal from '#/views/notifications/components/NotificationDetailModal.vue';

const router = useRouter();
const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
const notificationStore = useNotificationStore();
const customerServiceStore = useCustomerServiceStore();
const detailRef = ref<InstanceType<typeof NotificationDetailModal>>();
const { destroyWatermark, updateWatermark } = useWatermark();
const { isDark } = usePreferences();
const showDot = computed(() => notificationStore.unreadCount > 0);

// 顶栏气泡只展示未读项目通知，已读后即从气泡中移除
const notifications = computed<NotificationItem[]>(() =>
  notificationStore.unread.map((item) => ({
    id: item.id,
    avatar: kindAvatar(item.kind),
    date: formatDateTime(item.occurredAt),
    isRead: false,
    message: notificationSummary(item),
    title: notificationTitle(item),
  })),
);

function kindAvatar(kind: string) {
  const color = kind === 'accepted' ? '#1677ff' : '#13a8a8';
  const label = kind === 'accepted' ? '新' : '稿';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/><text x="20" y="27" font-size="20" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

onMounted(() => {
  if (accessStore.accessCodes.includes('notifications.read'))
    notificationStore.start();
});
watch(
  () => accessStore.accessCodes.includes('notifications.read'),
  (allowed) => {
    if (allowed) notificationStore.start();
    else notificationStore.stop();
  },
);
// 客服工作台事件流与提醒：有 customer-service.read 时全局常驻，切换页面不断开
const canReadCustomerService = () =>
  accessStore.accessCodes.includes('customer-service.read');
onMounted(() => {
  if (canReadCustomerService()) customerServiceStore.start();
});
watch(canReadCustomerService, (allowed) => {
  if (allowed) customerServiceStore.start();
  else customerServiceStore.stop();
});
onBeforeUnmount(() => {
  notificationStore.stop();
  customerServiceStore.stop();
});

const menus = computed(() => [
  {
    handler: () => {
      router.push({ name: 'Profile' });
    },
    icon: 'lucide:user',
    text: $t('page.auth.profile'),
  },
]);

const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

async function handleLogout() {
  await authStore.logout(false);
}

async function handleMarkAllRead() {
  await notificationStore.markAllRead();
}

function handleViewAll() {
  router.push('/notifications');
}

function handleClick(item: NotificationItem) {
  const row = notificationStore.unread.find((n) => n.id === item.id);
  if (row) detailRef.value?.open(row as ProjectNotification);
}

watch(
  () => ({
    enable: preferences.app.watermark,
    content: preferences.app.watermarkContent,
    isDark: isDark.value,
  }),
  async ({ enable, content, isDark: isDarkValue }) => {
    if (enable) {
      const watermarkColor = isDarkValue
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(0, 0, 0, 0.12)';

      await updateWatermark({
        advancedStyle: {
          colorStops: [
            {
              color: watermarkColor,
              offset: 0,
            },
            {
              color: watermarkColor,
              offset: 1,
            },
          ],
          type: 'linear',
        },
        content:
          content ||
          `${userStore.userInfo?.username} - ${userStore.userInfo?.realName}`,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout
    :avatar
    :text="userStore.userInfo?.realName"
    @clear-preferences-and-logout="handleLogout"
    @logout="handleLogout"
  >
    <template #user-dropdown>
      <UserDropdown
        :avatar
        :menus
        :text="userStore.userInfo?.realName"
        :description="userStore.userInfo?.email ?? ''"
        tag-text="Pro"
        @clear-preferences-and-logout="handleLogout"
        @logout="handleLogout"
      />
    </template>
    <template #notification>
      <Notification
        v-if="accessStore.accessCodes.includes('notifications.read')"
        :dot="showDot"
        :notifications="notifications"
        :allow-mark-read="
          accessStore.accessCodes.includes('notifications.mark-read')
        "
        :allow-mark-all-read="
          accessStore.accessCodes.includes('notifications.mark-all-read')
        "
        @clear="handleMarkAllRead"
        @read="(item) => notificationStore.markRead(String(item.id))"
        @make-all="handleMarkAllRead"
        @on-click="handleClick"
        @view-all="handleViewAll"
      />
    </template>
    <template #extra>
      <NotificationDetailModal
        ref="detailRef"
        @reload="notificationStore.reload"
      />
      <AuthenticationLoginExpiredModal
        v-model:open="accessStore.loginExpired"
        :avatar
      >
        <LoginForm />
      </AuthenticationLoginExpiredModal>
    </template>
    <template #lock-screen>
      <LockScreen :avatar @to-login="handleLogout" />
    </template>
  </BasicLayout>
</template>
