<script setup lang="ts">
import type {
  ProjectNotification,
  ProjectNotificationDetail,
} from '#/api/core/project-notifications';
import type { ProjectStatus } from '#/api/core/projects';

import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenModal } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Descriptions, DescriptionsItem, Spin, Tag } from 'ant-design-vue';

import {
  deliveryLabels,
  getProjectNotificationApi,
  markProjectNotificationReadApi,
  notificationKindLabels,
} from '#/api/core/project-notifications';
import { statusLabels } from '#/api/core/projects';

const emit = defineEmits<{ reload: [] }>();
const router = useRouter();
const detail = ref<ProjectNotificationDetail>();
const loading = ref(false);

const payloadLabels: Record<string, string> = {
  artworkJobId: '画稿任务',
  mappingStatus: '映射状态',
  revision: '项目版本',
};
const payloadRows = computed(() =>
  Object.entries(detail.value?.payload ?? {})
    .filter(([key]) => key in payloadLabels)
    .map(([key, value]) => ({
      label: payloadLabels[key],
      value: String(value),
    })),
);

const [Modal, modalApi] = useVbenModal({
  confirmText: '查看项目',
  cancelText: '关闭',
  onConfirm: () => {
    if (!detail.value) return;
    modalApi.close();
    router.push(`/projects/${detail.value.projectId}`);
  },
});

async function open(row: ProjectNotification) {
  detail.value = undefined;
  loading.value = true;
  modalApi.setState({ title: '通知详情' });
  modalApi.open();
  try {
    detail.value = await getProjectNotificationApi(row.id);
    // 打开详情即视为已读
    if (!detail.value.isRead) {
      await markProjectNotificationReadApi(row.id);
      emit('reload');
    }
  } catch {
    modalApi.close();
  } finally {
    loading.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <Modal class="w-[640px]">
    <Spin :spinning="loading">
      <Descriptions v-if="detail" bordered :column="1" size="small">
        <DescriptionsItem label="类型">
          {{ notificationKindLabels[detail.kind] ?? detail.kind }}
        </DescriptionsItem>
        <DescriptionsItem label="发生时间">
          {{ formatDateTime(detail.occurredAt) }}
        </DescriptionsItem>
        <DescriptionsItem label="项目编号">
          {{ detail.projectNo }}
        </DescriptionsItem>
        <DescriptionsItem label="项目状态">
          {{ statusLabels[detail.status as ProjectStatus] ?? detail.status }}
        </DescriptionsItem>
        <DescriptionsItem label="承接人">
          {{ detail.assigneeName }}
        </DescriptionsItem>
        <DescriptionsItem label="来源">
          {{ detail.sourceType === 'quote_request' ? '报价申请' : '人工需求' }}
        </DescriptionsItem>
        <DescriptionsItem label="企业">
          {{ detail.company ?? '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="联系人">
          {{ detail.contactName ?? '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="展会">
          {{ detail.exhibitionName ?? '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="方案编号">
          {{ detail.schemeCode ?? '—' }}
        </DescriptionsItem>
        <DescriptionsItem
          v-for="row in payloadRows"
          :key="row.label"
          :label="row.label"
        >
          {{ row.value }}
        </DescriptionsItem>
        <DescriptionsItem label="渠道投递">
          <Tag
            :color="
              detail.delivery === 'delivered'
                ? 'green'
                : detail.delivery === 'failed'
                  ? 'red'
                  : 'default'
            "
          >
            {{ deliveryLabels[detail.delivery] }}
          </Tag>
          <span v-if="detail.attempts" class="text-muted-foreground">
            已尝试 {{ detail.attempts }} 次
          </span>
          <span v-if="detail.lastErrorCode" class="ml-2 text-red-500">
            {{ detail.lastErrorCode }}
          </span>
        </DescriptionsItem>
        <DescriptionsItem v-if="detail.deliveredAt" label="投递时间">
          {{ formatDateTime(detail.deliveredAt) }}
        </DescriptionsItem>
      </Descriptions>
    </Spin>
  </Modal>
</template>
