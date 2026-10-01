<script setup lang="ts">
import type { ApplicabilityQuestion } from '#/api/core/applicability-questions';
import { Page } from '@vben/common-ui';
import { Button, message, Modal, Tag, Tooltip } from 'ant-design-vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteQuestionApi, updateQuestionApi } from '#/api/core/applicability-questions';
import QuestionFormModal from './components/QuestionFormModal.vue';
import { createFormOptions, createGridOptions } from './options';
import { ref } from 'vue';

const formModalRef = ref<InstanceType<typeof QuestionFormModal>>();
const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: createFormOptions(),
  gridOptions: createGridOptions(),
});

function handleCreate() {
  formModalRef.value?.open();
}

function handleEdit(row: ApplicabilityQuestion) {
  formModalRef.value?.open(row);
}

async function handleToggle(row: ApplicabilityQuestion) {
  try {
    await updateQuestionApi(row.id, { enabled: !row.enabled });
    message.success(row.enabled ? '已停用' : '已启用');
    gridApi.reload();
  } catch {
    message.error('操作失败');
  }
}

function handleDelete(row: ApplicabilityQuestion) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除适用条件问题「${row.label}」吗？删除后已使用此 ID 的方案规则将无法通过发布检查。`,
    okType: 'danger',
    onOk: async () => {
      try {
        await deleteQuestionApi(row.id);
        message.success('删除成功');
        gridApi.reload();
      } catch {
        message.error('删除失败');
      }
    },
  });
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <Button type="primary" @click="handleCreate">新建适用条件问题</Button>
      </template>

      <template #helpTextPreview="{ row }">
        <span class="text-xs font-mono text-gray-500">
          {{ row.helpText?.slice(0, 60) }}{{ row.helpText?.length > 60 ? '...' : '' }}
        </span>
      </template>

      <template #enabled="{ row }">
        <Tag :color="row.enabled ? 'success' : 'default'">
          {{ row.enabled ? '启用' : '停用' }}
        </Tag>
      </template>

      <template #action="{ row }">
        <Tooltip title="编辑">
          <Button type="link" size="small" @click="handleEdit(row)">
            <span class="icon-[lucide--pencil]"></span>
          </Button>
        </Tooltip>
        <Tooltip title="启用" v-if="!row.enabled">
          <Button type="link" size="small" @click="handleToggle(row)">
            <span class="icon-[lucide--toggle-left]"></span>
          </Button>
        </Tooltip>
        <Tooltip title="停用" v-else>
          <Button type="link" danger size="small" @click="handleToggle(row)">
            <span class="icon-[lucide--toggle-right]"></span>
          </Button>
        </Tooltip>
        <Tooltip title="删除">
          <Button type="link" danger size="small" @click="handleDelete(row)">
            <span class="icon-[lucide--trash-2]"></span>
          </Button>
        </Tooltip>
      </template>
    </Grid>

    <QuestionFormModal ref="formModalRef" @reload="gridApi.reload()" />
  </Page>
</template>