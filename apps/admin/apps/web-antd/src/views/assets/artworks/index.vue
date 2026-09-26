<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { debounce, formatDate } from '@vben/utils';

import { Button, message, Modal } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteAssetApi, getAssetDownloadUrlApi } from '#/api/core/assets';
import { getSchemeListApi } from '#/api/core/schemes';

import UploadModal from './components/UploadModal.vue';
import { createFormOptions, createGridOptions } from './options';

const uploadModalRef = ref<InstanceType<typeof UploadModal>>();

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
const gridOptions = createGridOptions('artwork');

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

function handleUpload() {
  uploadModalRef.value?.open();
}

async function handleDownload(row: any) {
  try {
    const res = await getAssetDownloadUrlApi(
      row.schemeCode,
      row.id,
      'attachment',
    );
    window.open(res.url, '_blank');
  } catch (error) {
    console.error(error);
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
        <Button type="primary" @click="handleUpload">上传平面素材</Button>
      </template>
      <template #filename="{ row }">
        {{ row.currentVersion?.originalFilename || '-' }}
      </template>
      <template #createdAt="{ row }">
        {{ formatDate(row.createdAt) }}
      </template>
      <template #action="{ row }">
        <Button type="link" size="small" @click="handleDownload(row)">
          下载
        </Button>
        <Button type="link" size="small" danger @click="handleDelete(row)">
          删除
        </Button>
      </template>
    </Grid>
    <UploadModal ref="uploadModalRef" @reload="gridApi.reload()" />
  </Page>
</template>
