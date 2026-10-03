<script setup lang="ts">
import type {
  AiModelRecord,
  AiProtocol,
  AiProviderRecord,
  PurposeAssignment,
} from '#/api/core/ai-models';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  message,
  Modal,
  Table,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteAiModelApi,
  deleteAiProviderApi,
  getAiModelAssignmentsApi,
  getAiProtocolsApi,
  KIND_LABELS,
  PURPOSE_LABELS,
} from '#/api/core/ai-models';

import AssignmentPanel from './components/AssignmentPanel.vue';
import ModelFormModal from './components/ModelFormModal.vue';
import ProviderFormModal from './components/ProviderFormModal.vue';
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

const modelColumns = [
  { title: '显示名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'kind', key: 'kind', width: 70 },
  { title: '模型 ID', dataIndex: 'model', key: 'model' },
  { title: '参数', dataIndex: 'params', key: 'params' },
  { title: '用途', dataIndex: 'purposes', key: 'purposes' },
  { title: '状态', dataIndex: 'enabled', key: 'enabled', width: 70 },
  { title: '操作', key: 'actions', width: 130 },
];

function protocolLabel(id: string) {
  return protocols.value.find((item) => item.id === id)?.label ?? id;
}

function paramSummary(model: AiModelRecord, provider: AiProviderRecord) {
  const fields =
    protocols.value
      .find((item) => item.id === provider.protocol)
      ?.kinds.find((item) => item.kind === model.kind)?.params ?? [];
  return (
    fields
      .map((field) => {
        const value = model.params[field.key] ?? field.default;
        const label =
          field.type === 'select'
            ? (field.options.find((option) => option.value === value)?.label ??
              value)
            : value;
        return `${field.label}: ${label}`;
      })
      .join('，') || '—'
  );
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
    <Tabs v-model:active-key="activeTab" class="h-full">
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
            <Table
              :columns="modelColumns"
              :data-source="row.models"
              :pagination="false"
              row-key="id"
              size="small"
              :locale="{ emptyText: '暂无模型，点击「添加模型」从供应商拉取' }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'kind'">
                  {{ KIND_LABELS[(record as AiModelRecord).kind] }}
                </template>
                <template v-else-if="column.key === 'model'">
                  <code class="text-xs">{{ record.model }}</code>
                </template>
                <template v-else-if="column.key === 'params'">
                  <span class="text-xs">{{
                    paramSummary(record as AiModelRecord, row)
                  }}</span>
                </template>
                <template v-else-if="column.key === 'purposes'">
                  <Tag
                    v-for="purpose in (record as AiModelRecord).purposes"
                    :key="purpose"
                    color="blue"
                  >
                    {{ PURPOSE_LABELS[purpose] }}
                  </Tag>
                  <span
                    v-if="!record.purposes.length"
                    class="text-xs text-muted-foreground"
                    >未分配</span>
                </template>
                <template v-else-if="column.key === 'enabled'">
                  <Tag :color="record.enabled ? 'success' : 'default'">
                    {{ record.enabled ? '启用' : '停用' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Button
                    type="link"
                    size="small"
                    @click="modelModalRef?.open(row, record as AiModelRecord)"
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    @click="confirmDeleteModel(record as AiModelRecord)"
                  >
                    删除
                  </Button>
                </template>
              </template>
            </Table>
          </template>
        </Grid>
      </TabPane>
      <TabPane key="assignments" tab="用途分配">
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
