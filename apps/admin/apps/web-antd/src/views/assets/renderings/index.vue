<script setup lang="ts">
import type { ImageSize } from '../shared/image-spec';
import type { SchemeFilterValues } from '../shared/scheme-filter';

import { onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { formatDate } from '@vben/utils';

import { Button, InputNumber, message, Modal } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteAssetApi,
  getAssetDownloadUrlApi,
  listSchemeAssetsApi,
  replaceAssetFileApi,
  updateAssetApi,
} from '#/api/core/assets';

import {
  pairedMaskWarning,
  readImageSize,
  renderingSizeError,
} from '../shared/image-spec';
import {
  createSchemeFilterFormOptions,
  useRouteSchemeCode,
  useSchemeOptions,
} from '../shared/scheme-filter';
import UploadModal from './components/UploadModal.vue';
import { createGridOptions } from './options';

const uploadModalRef = ref<InstanceType<typeof UploadModal>>();
const { hasAccessByCodes } = useAccess();

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
const gridOptions = createGridOptions('rendering');

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
    let size: ImageSize;
    try {
      size = await readImageSize(file);
    } catch (error) {
      message.error((error as Error).message);
      return;
    }
    const sizeError = renderingSizeError(size);
    if (sizeError) {
      message.error(sizeError);
      return;
    }
    try {
      const masks = await listSchemeAssetsApi(row.schemeCode, 'mask');
      const warning = pairedMaskWarning(
        size,
        masks.find((mask) => mask.relatedAssetId === row.id),
      );
      if (warning && !(await confirmReplace(warning))) return;
      await replaceAssetFileApi(row.schemeCode, row.id, file, row.revision);
      message.success(warning ? '替换成功，请继续替换对应蒙版' : '替换成功');
      gridApi.reload();
    } catch (error) {
      // 接口错误已由请求拦截器提示具体原因
      console.error(error);
    }
  });
  input.click();
}

function confirmReplace(content: string): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '蒙版尺寸将不一致',
      content,
      okText: '继续替换',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

async function handleSortOrderChange(value: any, row: any) {
  let num: null | number = null;
  if (typeof value === 'number') num = value;
  else if (value) num = Number(value);
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
        >
          上传效果图
        </Button>
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
