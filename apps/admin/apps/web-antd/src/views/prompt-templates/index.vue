<script setup lang="ts">
import type { PromptTemplate } from '#/api/core/prompt-templates';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Alert, Button, message, Tag, Tooltip } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { updatePromptTemplateApi } from '#/api/core/prompt-templates';
import { getSchemeOptionsApi } from '#/api/core/schemes';

import PromptTemplateFormModal from './components/PromptTemplateFormModal.vue';
import { createFormOptions, createGridOptions } from './options';

const formOptions = createFormOptions();
const gridOptions = createGridOptions();
const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

const optionLabels = ref<Record<string, string>>({});

async function fetchOptions() {
  try {
    const res = await getSchemeOptionsApi();
    optionLabels.value = Object.fromEntries(
      [...(res.industry || []), ...(res.style || [])].map((o) => [
        o.id,
        o.label,
      ]),
    );
    gridApi.formApi.updateSchema([
      {
        fieldName: 'industryId',
        componentProps: {
          options: (res.industry || []).map((o) => ({
            label: o.label,
            value: o.id,
          })),
        },
      },
      {
        fieldName: 'styleId',
        componentProps: {
          options: (res.style || []).map((o) => ({
            label: o.label,
            value: o.id,
          })),
        },
      },
    ]);
  } catch (error) {
    console.error('Failed to load options', error);
  }
}

onMounted(() => {
  fetchOptions();
});

const formModalRef = ref<InstanceType<typeof PromptTemplateFormModal>>();

function handleCreate() {
  formModalRef.value?.open();
}

function handleEdit(row: PromptTemplate) {
  formModalRef.value?.open(row);
}

function onReload() {
  gridApi.reload();
}

async function handleToggle(row: PromptTemplate) {
  try {
    await updatePromptTemplateApi(row.id, {
      enabled: !row.enabled,
      expectedRevision: row.revision,
    });
    message.success(row.enabled ? '已停用' : '已启用');
    gridApi.reload();
  } catch {
    message.error(
      '操作失败：请检查变量和适用范围；同一范围只能启用一份模板，版本冲突请刷新后重试',
    );
  }
}
</script>
<template>
  <Page auto-content-height>
    <Alert
      class="mb-3"
      type="info"
      show-icon
      message="三类业务独立配置；没有启用模板时自动使用服务端内置默认。"
      description="图片业务匹配顺序：行业 + 风格 → 行业 → 风格 → 通用。新建模板默认停用；更新启用模板只影响新请求，已受理任务保留原提示词。"
    />
    <Grid>
      <template #toolbar-actions>
        <Button type="primary" @click="handleCreate">新建模板</Button>
      </template>

      <!-- 列插槽 -->
      <template #purpose="{ row }">
        <Tag
          :color="
            row.purpose === 'theme'
              ? 'blue'
              : row.purpose === 'filter'
                ? 'green'
                : 'orange'
          "
        >
          {{
            row.purpose === 'theme'
              ? 'AI 换主题'
              : row.purpose === 'filter'
                ? 'AI 智选 · 需求解析'
                : 'AI 四向图'
          }}
        </Tag>
      </template>

      <template #industryId="{ row }">
        <span v-if="row.industryId">{{
          optionLabels[row.industryId] ?? row.industryId
        }}</span>
        <span v-else class="text-muted-foreground">通用</span>
      </template>

      <template #styleId="{ row }">
        <span v-if="row.styleId">{{
          optionLabels[row.styleId] ?? row.styleId
        }}</span>
        <span v-else class="text-muted-foreground">通用</span>
      </template>

      <template #bodyPreview="{ row }">
        <span class="text-xs font-mono">
          {{ row.body?.slice(0, 60) }}{{ row.body?.length > 60 ? '...' : '' }}
        </span>
      </template>

      <template #enabled="{ row }">
        <Tag :color="row.enabled ? 'green' : 'default'">
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
      </template>
    </Grid>

    <PromptTemplateFormModal ref="formModalRef" @reload="onReload" />
  </Page>
</template>
