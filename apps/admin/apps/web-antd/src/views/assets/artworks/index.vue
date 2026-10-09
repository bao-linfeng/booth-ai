<script setup lang="ts">
import type { SchemeFilterValues } from '../shared/scheme-filter';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { formatDate } from '@vben/utils';

import { Button, message, Modal } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteAssetApi,
  getAssetDownloadUrlApi,
  replaceAssetFileApi,
} from '#/api/core/assets';

import {
  createSchemeFilterFormOptions,
  useRouteSchemeCode,
  useSchemeOptions,
} from '../shared/scheme-filter';
import UploadModal from './components/UploadModal.vue';
import { createGridOptions } from './options';

const uploadModalRef = ref<InstanceType<typeof UploadModal>>();

const schemes = useSchemeOptions();
const initialSchemeCode = useRouteSchemeCode(applySchemeFilter);
schemes.pin(initialSchemeCode);

onMounted(() => {
  schemes.search();
});

const formOptions = createSchemeFilterFormOptions({
  defaultSchemeCode: initialSchemeCode,
  loading: schemes.loading,
  onSearch: schemes.onSearch,
  options: schemes.options,
});
const gridOptions = createGridOptions('artwork');

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

async function applySchemeFilter(code: string | undefined) {
  schemes.pin(code);
  await gridApi.formApi.setFieldValue('schemeCode', code);
  const values = await gridApi.formApi.getValues();
  gridApi.formApi.setLatestSubmissionValues(values);
  gridApi.reload(values);
}

function handleUpload() {
  // 上传默认归属列表当前生效的筛选方案
  const { schemeCode } =
    gridApi.formApi.getLatestSubmissionValues() as SchemeFilterValues;
  uploadModalRef.value?.open(schemeCode);
}

async function handleReplace(row: any) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.webp';
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
        <Button
          v-access:code="['assets-artworks.upload']"
          type="primary"
          @click="handleUpload"
        >
          上传平面素材
        </Button>
      </template>
      <template #filename="{ row }">
        {{ row.currentVersion?.originalFilename || '-' }}
      </template>
      <template #createdAt="{ row }">
        {{ formatDate(row.createdAt) }}
      </template>
      <template #action="{ row }">
        <Button
          v-access:code="['assets-artworks.replace']"
          type="link"
          size="small"
          @click="handleReplace(row)"
        >
          替换
        </Button>
        <Button
          v-access:code="['assets-artworks.download']"
          type="link"
          size="small"
          @click="handleDownload(row)"
        >
          下载
        </Button>
        <Button
          v-access:code="['assets-artworks.delete']"
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
