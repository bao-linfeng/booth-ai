<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, message, Modal, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteSchemeApi, getSchemeOptionsApi } from '#/api/core/schemes';

import SchemeFormModal from './components/SchemeFormModal.vue';
import SchemeImportModal from './components/SchemeImportModal.vue';
import { createFormOptions, createGridOptions } from './options';

const router = useRouter();
const schemeFormModalRef = ref<InstanceType<typeof SchemeFormModal>>();
const schemeImportModalRef = ref<InstanceType<typeof SchemeImportModal>>();
const optionLabels = ref<Record<string, string>>({});

const formOptions = createFormOptions();
const gridOptions = createGridOptions();

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

async function fetchOptions() {
  try {
    const res = await getSchemeOptionsApi();
    optionLabels.value = Object.fromEntries(
      Object.values(res)
        .flat()
        .map((item) => [item.id, item.label]),
    );
    if (res && res.style) {
      gridApi.formApi.updateSchema([
        {
          fieldName: 'styleId',
          componentProps: {
            options: res.style.map((opt) => ({
              label: opt.label,
              value: opt.id,
            })),
          },
        },
        {
          fieldName: 'productSystemId',
          componentProps: {
            options: (res.product_system || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
        {
          fieldName: 'industryId',
          componentProps: {
            options: (res.industry || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
      ]);
    }
  } catch (error) {
    console.error('Failed to load catalog options:', error);
  }
}

function handleCreate() {
  schemeFormModalRef.value?.open();
}

function handleImport() {
  schemeImportModalRef.value?.open();
}

function handleEdit(row: any) {
  schemeFormModalRef.value?.open(row);
}

function handleDetail(code: string) {
  router.push(`/scheme/detail/${code}`);
}

function handleDelete(row: any) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除方案 ${row.name || row.code} 吗？`,
    okText: '确认',
    cancelText: '取消',
    onOk: async () => {
      try {
        await deleteSchemeApi(row.code);
        message.success('删除成功');
        gridApi.reload();
      } catch (error) {
        console.error(error);
        message.error('删除失败');
      }
    },
  });
}

function onReload() {
  gridApi.reload();
}

onMounted(() => {
  fetchOptions();
});
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <div class="flex gap-2">
          <Button @click="handleImport">批量导入</Button>
          <Button type="primary" @click="handleCreate">新建方案</Button>
        </div>
      </template>

      <template #dimensions="{ row }">
        {{ row.lengthMm ?? '-' }} × {{ row.widthMm ?? '-' }} ×
        {{ row.heightMm ?? '-' }}
      </template>

      <template #openingCount="{ row }">
        {{ row.openingCount ? `${row.openingCount} 面` : '-' }}
      </template>

      <template #productSystem="{ row }">
        {{ optionLabels[row.productSystemId] ?? '-' }}
      </template>
      <template #style="{ row }">
        {{ optionLabels[row.styleId] ?? '-' }}
      </template>

      <template #publishStatus="{ row }">
        <Tag v-if="row.publishStatus === 'published'" color="green">已发布</Tag>
        <Tag v-else-if="row.publishStatus === 'unpublished'" color="orange">
          未发布
        </Tag>
        <Tag v-else>草稿</Tag>
      </template>

      <template #verificationStatus="{ row }">
        <Tag v-if="row.verificationStatus === 'verified'" color="green">
          核验通过
        </Tag>
        <Tag v-else-if="row.verificationStatus === 'failed'" color="red">
          核验失败
        </Tag>
        <Tag v-else>未核验</Tag>
      </template>

      <template #action="{ row }">
        <Button type="link" size="small" @click="handleDetail(row.code)">
          详情
        </Button>
        <Button type="link" size="small" @click="handleEdit(row)">编辑</Button>
        <Button type="link" size="small" danger @click="handleDelete(row)">
          删除
        </Button>
      </template>
    </Grid>

    <SchemeFormModal ref="schemeFormModalRef" @reload="onReload" />
    <SchemeImportModal ref="schemeImportModalRef" @reload="onReload" />
  </Page>
</template>
