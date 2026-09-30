<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Page } from '@vben/common-ui';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { createFormOptions, createGridOptions } from './options';
import PromptTemplateFormModal from './components/PromptTemplateFormModal.vue';
import { Button, Tag, Tooltip, message } from 'ant-design-vue';
import { updatePromptTemplateApi, type PromptTemplate } from '#/api/core/prompt-templates';
import { getSchemeOptionsApi } from '#/api/core/schemes';

const formOptions = createFormOptions();
const gridOptions = createGridOptions();
const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

const optionLabels = ref<Record<string, string>>({});

async function fetchOptions() {
  try {
    const res = await getSchemeOptionsApi();
    optionLabels.value = Object.fromEntries(
      [...(res.industry || []), ...(res.style || [])].map(o => [o.id, o.label])
    );
    gridApi.formApi.updateSchema([
      { fieldName: 'industryId', componentProps: { options: (res.industry || []).map(o => ({ label: o.label, value: o.id })) } },
      { fieldName: 'styleId', componentProps: { options: (res.style || []).map(o => ({ label: o.label, value: o.id })) } },
    ]);
  } catch (e) {
    console.error('Failed to load options', e);
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
      expectedRevision: row.revision 
    });
    message.success(row.enabled ? '已停用' : '已启用');
    gridApi.reload();
  } catch (e: any) {
    if (e?.response?.status === 409) {
      message.error('该组合已有其他启用模板，请先停用再试');
    } else {
      message.error('操作失败');
    }
  }
}
</script>
<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <Button type="primary" @click="handleCreate">新建模板</Button>
      </template>
      
      <!-- 列插槽 -->
      <template #purpose="{ row }">
        <Tag :color="row.purpose === 'theme' ? 'blue' : 'orange'">
          {{ row.purpose === 'theme' ? '换主题' : '四面图' }}
        </Tag>
      </template>
      
      <template #industryId="{ row }">
        <span v-if="row.industryId">{{ optionLabels[row.industryId] ?? row.industryId }}</span>
        <span v-else class="text-muted-foreground">通用</span>
      </template>
      
      <template #styleId="{ row }">
        <span v-if="row.styleId">{{ optionLabels[row.styleId] ?? row.styleId }}</span>
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
            <span class="icon-[lucide--pencil]" />
          </Button>
        </Tooltip>
        <Tooltip title="启用" v-if="!row.enabled">
          <Button type="link" size="small" @click="handleToggle(row)">
            <span class="icon-[lucide--toggle-left]" />
          </Button>
        </Tooltip>
        <Tooltip title="停用" v-else>
          <Button type="link" danger size="small" @click="handleToggle(row)">
            <span class="icon-[lucide--toggle-right]" />
          </Button>
        </Tooltip>
      </template>
    </Grid>
    
    <PromptTemplateFormModal ref="formModalRef" @reload="onReload" />
  </Page>
</template>
