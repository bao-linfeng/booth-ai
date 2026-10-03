<script setup lang="ts">
import type {
  AiModelRecord,
  AiProtocol,
  AiProviderRecord,
  PurposeAssignment,
} from '#/api/core/ai-models';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, message, Modal, TabPane, Tabs, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteAiModelApi,
  deleteAiProviderApi,
  getAiModelAssignmentsApi,
  getAiProtocolsApi,
} from '#/api/core/ai-models';

import AssignmentPanel from './components/AssignmentPanel.vue';
import ModelFormModal from './components/ModelFormModal.vue';
import ProviderFormModal from './components/ProviderFormModal.vue';
import ProviderModelsTable from './components/ProviderModelsTable.vue';
import { createProviderGridOptions } from './options';

const protocols = ref<AiProtocol[]>([]);
const providers = ref<AiProviderRecord[]>([]);
const assignments = ref<PurposeAssignment[]>([]);
const activeTab = ref('providers');

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: createProviderGridOptions((items) => {
    providers.value = items;
  }),
});

const providerModalRef = ref<InstanceType<typeof ProviderFormModal>>();
const modelModalRef = ref<InstanceType<typeof ModelFormModal>>();

function protocolLabel(id: string) {
  return protocols.value.find((item) => item.id === id)?.label ?? id;
}

async function loadAssignments() {
  assignments.value = await getAiModelAssignmentsApi();
}

async function reload() {
  await Promise.all([gridApi.reload(), loadAssignments()]);
}

function confirmDeleteProvider(provider: AiProviderRecord) {
  Modal.confirm({
    title: `删除供应商「${provider.name}」？`,
    content: '只能删除没有模型的供应商；已保存的密钥会一并删除。',
    okType: 'danger',
    onOk: async () => {
      await deleteAiProviderApi(provider.id);
      message.success('供应商已删除');
      await reload();
    },
  });
}

function confirmDeleteModel(model: AiModelRecord) {
  Modal.confirm({
    title: `删除模型「${model.name}」？`,
    content:
      model.purposes.length > 0
        ? '该模型仍被用途使用，需先在「用途分配」中移除。'
        : '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteAiModelApi(model.id);
      message.success('模型已删除');
      await reload();
    },
  });
}

onMounted(async () => {
  protocols.value = await getAiProtocolsApi();
  await loadAssignments();
});
</script>

<template>
  <Page auto-content-height>
    <Tabs v-model:active-key="activeTab" class="ai-model-tabs h-full">
      <TabPane key="providers" tab="供应商与模型" class="h-full">
        <Grid>
          <template #toolbar-actions>
            <Button
              type="primary"
              :disabled="!protocols.length"
              @click="providerModalRef?.open()"
            >
              新建供应商
            </Button>
          </template>
          <template #protocol="{ row }">
            {{ protocolLabel(row.protocol) }}
          </template>
          <template #credential="{ row }">
            <Tag :color="row.credentialConfigured ? 'success' : 'warning'">
              {{ row.credentialConfigured ? '已配置' : '缺少' }}
            </Tag>
          </template>
          <template #enabled="{ row }">
            <Tag :color="row.enabled ? 'success' : 'default'">
              {{ row.enabled ? '启用' : '停用' }}
            </Tag>
          </template>
          <template #modelCount="{ row }">{{ row.models.length }}</template>
          <template #actions="{ row }">
            <Button type="link" size="small" @click="modelModalRef?.open(row)">
              添加模型
            </Button>
            <Button
              type="link"
              size="small"
              @click="providerModalRef?.open(row)"
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              danger
              @click="confirmDeleteProvider(row)"
            >
              删除
            </Button>
          </template>
          <template #models="{ row }">
            <ProviderModelsTable
              :provider="row"
              :protocols="protocols"
              @edit="modelModalRef?.open(row, $event)"
              @delete="confirmDeleteModel"
            />
          </template>
        </Grid>
      </TabPane>
      <TabPane key="assignments" tab="用途分配" class="h-full overflow-y-auto">
        <AssignmentPanel
          :assignments="assignments"
          :protocols="protocols"
          :providers="providers"
          @reload="reload"
        />
      </TabPane>
    </Tabs>
    <ProviderFormModal
      ref="providerModalRef"
      :protocols="protocols"
      @reload="reload"
    />
    <ModelFormModal
      ref="modelModalRef"
      :protocols="protocols"
      @reload="reload"
    />
  </Page>
</template>

<style scoped>
.ai-model-tabs :deep(.ant-tabs-content) {
  height: 100%;
}
</style>
