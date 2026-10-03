<script setup lang="ts">
import type {
  AiModelRecord,
  AiProtocol,
  AiProviderRecord,
} from '#/api/core/ai-models';

import { watch } from 'vue';

import { Button, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { KIND_LABELS, PURPOSE_LABELS } from '#/api/core/ai-models';

const props = defineProps<{
  protocols: AiProtocol[];
  provider: AiProviderRecord;
}>();
const emit = defineEmits<{
  delete: [model: AiModelRecord];
  edit: [model: AiModelRecord];
}>();

const [Grid, gridApi] = useVbenVxeGrid<AiModelRecord>({
  gridOptions: {
    minHeight: 0,
    pagerConfig: { enabled: false },
    proxyConfig: { enabled: false },
    toolbarConfig: { enabled: false },
    rowConfig: { keyField: 'id' },
    emptyText: '暂无模型，点击「添加模型」从供应商拉取',
    columns: [
      { field: 'name', title: '显示名称', minWidth: 140 },
      { field: 'kind', title: '类型', width: 70, slots: { default: 'kind' } },
      { field: 'model', title: '模型 ID', minWidth: 180 },
      {
        field: 'params',
        title: '参数',
        minWidth: 180,
        slots: { default: 'params' },
      },
      {
        field: 'purposes',
        title: '用途',
        minWidth: 180,
        slots: { default: 'purposes' },
      },
      {
        field: 'enabled',
        title: '状态',
        width: 80,
        slots: { default: 'enabled' },
      },
      {
        title: '操作',
        width: 130,
        fixed: 'right',
        slots: { default: 'actions' },
      },
    ],
  },
});

watch(
  () => props.provider.models,
  (data) => gridApi.setGridOptions({ data }),
  { immediate: true },
);

function paramSummary(model: AiModelRecord) {
  const fields =
    props.protocols
      .find((item) => item.id === props.provider.protocol)
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
</script>

<template>
  <Grid class="h-auto">
    <template #kind="{ row }">{{ KIND_LABELS[row.kind] }}</template>
    <template #params="{ row }">{{ paramSummary(row) }}</template>
    <template #purposes="{ row }">
      <Tag v-for="purpose in row.purposes" :key="purpose" color="blue">
        {{ PURPOSE_LABELS[purpose] }}
      </Tag>
      <span v-if="!row.purposes.length" class="text-xs text-muted-foreground">
        未分配
      </span>
    </template>
    <template #enabled="{ row }">
      <Tag :color="row.enabled ? 'success' : 'default'">
        {{ row.enabled ? '启用' : '停用' }}
      </Tag>
    </template>
    <template #actions="{ row }">
      <Button type="link" size="small" @click="emit('edit', row)">编辑</Button>
      <Button type="link" size="small" danger @click="emit('delete', row)">
        删除
      </Button>
    </template>
  </Grid>
</template>
