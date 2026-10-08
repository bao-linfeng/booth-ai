<script setup lang="ts">
import type { CsAgent } from '#/api/core/customer-service';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Form, FormItem, Input, message, Select } from 'ant-design-vue';

import {
  listAgentsApi,
  transferConversationApi,
} from '#/api/core/customer-service';

const emit = defineEmits<{ done: [] }>();
const QUEUE = '__queue__';

const conversationId = ref('');
const agents = ref<CsAgent[]>([]);
const target = ref<string>(QUEUE);
const reason = ref('');

const options = computed(() => [
  { label: '退回队列', value: QUEUE },
  ...agents.value.map((agent) => ({
    label: `${agent.displayName}（${agent.online ? '在线' : '离线'} · 接待 ${agent.activeCount}）`,
    value: agent.adminId,
  })),
]);

const [Modal, modalApi] = useVbenModal({
  title: '改派会话',
  onConfirm: submit,
});

async function submit() {
  if (!reason.value.trim()) {
    message.warning('请填写改派原因');
    return;
  }
  modalApi.setState({ confirmLoading: true });
  try {
    await transferConversationApi(conversationId.value, {
      adminId: target.value === QUEUE ? null : target.value,
      reason: reason.value.trim(),
    });
    message.success('已改派');
    emit('done');
    modalApi.close();
  } finally {
    modalApi.setState({ confirmLoading: false });
  }
}

async function open(id: string, currentAgentId: null | string) {
  conversationId.value = id;
  target.value = QUEUE;
  reason.value = '';
  modalApi.open();
  const list = await listAgentsApi();
  agents.value = list.filter((agent) => agent.adminId !== currentAgentId);
}

defineExpose({ open });
</script>

<template>
  <Modal>
    <Form layout="vertical">
      <FormItem label="改派给" required>
        <Select
          v-model:value="target"
          :options="options"
          show-search
          option-filter-prop="label"
        />
      </FormItem>
      <FormItem label="原因（仅后台可见）" required>
        <Input.TextArea
          v-model:value="reason"
          :maxlength="500"
          :rows="3"
          show-count
        />
      </FormItem>
    </Form>
  </Modal>
</template>
