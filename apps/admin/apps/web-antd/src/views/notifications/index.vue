<script setup lang="ts">
import type { ProjectNotification } from '#/api/core/project-notifications';

import { ref, watch } from 'vue';

import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Button, message, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deliveryLabels,
  notificationKindLabels,
  notificationSummary,
} from '#/api/core/project-notifications';
import { useNotificationStore } from '#/store';

import NotificationDetailModal from './components/NotificationDetailModal.vue';
import { createFormOptions, createGridOptions } from './options';

const notificationStore = useNotificationStore();
const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: createFormOptions(),
  gridOptions: createGridOptions(),
});

const detailRef = ref<InstanceType<typeof NotificationDetailModal>>();

// 已读状态变更（含顶栏气泡中的操作）后重新加载列表
watch(
  () => notificationStore.version,
  () => gridApi.reload(),
);

async function handleMarkAllRead() {
  await notificationStore.markAllRead();
  message.success('已全部标为已读');
}

const deliveryColors = {
  delivered: 'green',
  failed: 'red',
  pending: 'default',
} as const;
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <Button
          :disabled="notificationStore.unreadCount <= 0"
          @click="handleMarkAllRead"
        >
          全部已读
        </Button>
      </template>

      <template #kind="{ row }">
        <Tag color="blue">
          {{
            notificationKindLabels[(row as ProjectNotification).kind] ??
            (row as ProjectNotification).kind
          }}
        </Tag>
      </template>

      <template #summary="{ row }">
        {{ notificationSummary(row as ProjectNotification) }}
      </template>

      <template #delivery="{ row }">
        <Tag :color="deliveryColors[(row as ProjectNotification).delivery]">
          {{ deliveryLabels[(row as ProjectNotification).delivery] }}
        </Tag>
      </template>

      <template #read="{ row }">
        <Tag :color="(row as ProjectNotification).isRead ? 'default' : 'blue'">
          {{ (row as ProjectNotification).isRead ? '已读' : '未读' }}
        </Tag>
      </template>

      <template #occurredAt="{ row }">
        {{ formatDateTime((row as ProjectNotification).occurredAt) }}
      </template>

      <template #action="{ row }">
        <Button
          type="link"
          size="small"
          @click="detailRef?.open(row as ProjectNotification)"
        >
          详情
        </Button>
      </template>
    </Grid>

    <NotificationDetailModal
      ref="detailRef"
      @reload="notificationStore.reload"
    />
  </Page>
</template>
