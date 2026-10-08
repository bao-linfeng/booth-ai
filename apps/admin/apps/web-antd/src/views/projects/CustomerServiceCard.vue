<script setup lang="ts">
import type { AdminConversation } from '#/api/core/customer-service';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { formatDateTime } from '@vben/utils';

import { Card, Table, Tag } from 'ant-design-vue';

import {
  listConversationsApi,
  STATUS_LABELS,
} from '#/api/core/customer-service';

/** 项目详情“客服会话”：列出挂有该项目上下文的会话，需同时具备 projects.read 与 customer-service.read */
const props = defineProps<{ projectId: string }>();
const router = useRouter();
const { hasAccessByCodes } = useAccess();
const visible =
  hasAccessByCodes(['projects.read']) &&
  hasAccessByCodes(['customer-service.read']);
const items = ref<AdminConversation[]>([]);
const loading = ref(false);

const columns = [
  { dataIndex: 'conversationNo', key: 'conversationNo', title: '会话号' },
  { dataIndex: 'status', key: 'status', title: '状态' },
  { dataIndex: 'agentName', key: 'agentName', title: '坐席' },
  { dataIndex: 'lastMessageAt', key: 'lastMessageAt', title: '最后消息' },
];
const statusColors = {
  active: 'green',
  closed: 'default',
  queued: 'orange',
} as const;

onMounted(async () => {
  if (!visible) return;
  loading.value = true;
  try {
    const page = await listConversationsApi({
      pageSize: 50,
      projectId: props.projectId,
    });
    items.value = page.items;
  } finally {
    loading.value = false;
  }
});

function open(row: AdminConversation) {
  void router.push({
    name: 'CustomerServiceWorkbench',
    query: { conversationId: row.id },
  });
}
</script>

<template>
  <Card v-if="visible" title="客服会话">
    <Table
      :columns="columns"
      :custom-row="
        (row: AdminConversation) => ({
          onClick: () => open(row),
          style: 'cursor: pointer',
        })
      "
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <Tag :color="statusColors[(record as AdminConversation).status]">
            {{ STATUS_LABELS[(record as AdminConversation).status] }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'agentName'">
          {{ (record as AdminConversation).agentName ?? '—' }}
        </template>
        <template v-else-if="column.key === 'lastMessageAt'">
          {{
            (record as AdminConversation).lastMessageAt
              ? formatDateTime((record as AdminConversation).lastMessageAt!)
              : '—'
          }}
        </template>
      </template>
      <template #emptyText>暂无关联的客服会话</template>
    </Table>
  </Card>
</template>
