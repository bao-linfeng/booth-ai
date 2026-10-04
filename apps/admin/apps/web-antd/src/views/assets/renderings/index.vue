<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { debounce, formatDate } from '@vben/utils';

import { Button, InputNumber, message, Modal } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteAssetApi,
  getAssetDownloadUrlApi,
  replaceAssetFileApi,
  updateAssetApi,
} from '#/api/core/assets';
import { getSchemeListApi } from '#/api/core/schemes';

import UploadModal from './components/UploadModal.vue';
import { createFormOptions, createGridOptions } from './options';

const uploadModalRef = ref<InstanceType<typeof UploadModal>>();
const { hasAccessByCodes } = useAccess();

const schemeOptions = ref<{ label: string; value: string }[]>([]);
const schemeLoading = ref(false);

async function fetchSchemes(keyword?: string) {
  schemeLoading.value = true;
  try {
    const res = await getSchemeListApi({
      ...(keyword ? { code: keyword } : {}),
      pageSize: 20,
    });
    schemeOptions.value = (res.data ?? []).map((item) => ({
      label: `${item.code} - ${item.name}`,
      value: item.code,
    }));
  } finally {
    schemeLoading.value = false;
  }
}

const handleSchemeSearch = debounce((value: string) => {
  fetchSchemes(value || undefined);
}, 300);

onMounted(() => {
  fetchSchemes();
});

const formOptions = createFormOptions({
  options: schemeOptions,
  loading: schemeLoading,
  onSearch: handleSchemeSearch,
});
const gridOptions = createGridOptions('rendering');

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

function handleUpload() {
  uploadModalRef.value?.open();
}

async function handlePreview(row: any) {
  try {
    const res = await getAssetDownloadUrlApi(row.schemeCode, row.id, 'preview');
    window.open(res.url, '_blank');
  } catch (error) {
    console.error(error);
  }
}

async function handleReplace(row: any) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.jpg,.jpeg,.png,.webp';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await replaceAssetFileApi(row.schemeCode, row.id, file, row.revision);
      message.success('替换成功');
      gridApi.reload();
    } catch {
      message.error('替换失败');
    }
  });
  input.click();
}

async function handleSortOrderChange(value: any, row: any) {
  const num = typeof value === 'number' ? value : value ? Number(value) : null;
  if (num === null || num === row.sortOrder || Number.isNaN(num)) return;
  try {
    await updateAssetApi(row.schemeCode, row.id, {
      sortOrder: num,
      expectedRevision: row.revision,
    });
    message.success('排序已更新');
    gridApi.reload();
  } catch {
    message.error('排序更新失败，列表已刷新');
    gridApi.reload();
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除「${row.name}」吗？`,
    okText: '确认',
    cancelText: '取消',
    onOk: async () => {
      try {
        await deleteAssetApi(row.schemeCode, row.id, row.revision);
        message.success('删除成功');
        gridApi.reload();
      } catch (error) {
        console.error(error);
      }
    },
  });
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <Button
          v-access:code="['assets-renderings.upload']"
          type="primary"
          @click="handleUpload"
          >上传效果图</Button
        >
      </template>
      <template #filename="{ row }">
        {{ row.currentVersion?.originalFilename || '-' }}
      </template>
      <template #sortOrder="{ row }">
        <InputNumber
          :value="row.sortOrder"
          :disabled="!hasAccessByCodes(['assets-renderings.update'])"
          :min="0"
          size="small"
          class="w-20"
          @change="(value) => handleSortOrderChange(value, row)"
        />
      </template>
      <template #createdAt="{ row }">
        {{ formatDate(row.createdAt) }}
      </template>
      <template #action="{ row }">
        <Button
          v-access:code="['assets-renderings.preview']"
          type="link"
          size="small"
          @click="handlePreview(row)"
        >
          预览
        </Button>
        <Button
          v-access:code="['assets-renderings.replace']"
          type="link"
          size="small"
          @click="handleReplace(row)"
        >
          替换
        </Button>
        <Button
          v-access:code="['assets-renderings.delete']"
          type="link"
          size="small"
          danger
          @click="handleDelete(row)"
        >
          删除
        </Button>
      </template>
    </Grid>
    <UploadModal ref="uploadModalRef" @reload="gridApi.reload()" />
  </Page>
</template>
