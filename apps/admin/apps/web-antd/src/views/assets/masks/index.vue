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
  maskSizeError,
  readImageSize,
  versionImageSize,
} from '../shared/image-spec';
import {
  createSchemeFilterFormOptions,
  useRouteSchemeCode,
  useSchemeOptions,
} from '../shared/scheme-filter';
import MaskOverlayModal from './components/MaskOverlayModal.vue';
import UploadModal from './components/UploadModal.vue';
import { createGridOptions } from './options';

const uploadModalRef = ref<InstanceType<typeof UploadModal>>();
const { hasAccessByCodes } = useAccess();
const overlayModalRef = ref<InstanceType<typeof MaskOverlayModal>>();

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
const gridOptions = createGridOptions('mask');

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
  if (!row.relatedAssetId) {
    message.warning('该蒙版未配对效果图，无法叠加预览');
    return;
  }

  try {
    const assets = await listSchemeAssetsApi(row.schemeCode, 'rendering');
    const renderingRow = assets.find((a: any) => a.id === row.relatedAssetId);

    if (!renderingRow) {
      message.error('未找到配对的效果图数据');
      return;
    }

    overlayModalRef.value?.open(row, renderingRow);
  } catch (error) {
    console.error(error);
    message.error('获取效果图信息失败');
  }
}

async function handleReplace(row: any) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.webp';
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
    try {
      // 未配对的蒙版没有尺寸基准，交由发布检查兜底
      if (row.relatedAssetId) {
        const renderings = await listSchemeAssetsApi(
          row.schemeCode,
          'rendering',
        );
        const rendering = renderings.find((a) => a.id === row.relatedAssetId);
        const sizeError = maskSizeError(
          size,
          versionImageSize(rendering?.currentVersion),
        );
        if (sizeError) {
          message.error(sizeError);
          return;
        }
      }
      await replaceAssetFileApi(row.schemeCode, row.id, file, row.revision);
      message.success('替换成功');
      gridApi.reload();
    } catch (error) {
      // 接口错误已由请求拦截器提示具体原因
      console.error(error);
    }
  });
  input.click();
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
          v-access:code="['assets-masks.upload']"
          type="primary"
          @click="handleUpload"
        >
          上传蒙版
        </Button>
      </template>
      <template #filename="{ row }">
        {{ row.currentVersion?.originalFilename || '-' }}
      </template>
      <template #sortOrder="{ row }">
        <InputNumber
          :value="row.sortOrder"
          :disabled="!hasAccessByCodes(['assets-masks.update'])"
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
          v-access:code="['assets-masks.preview']"
          type="link"
          size="small"
          @click="handlePreview(row)"
        >
          预览
        </Button>
        <Button
          v-access:code="['assets-masks.replace']"
          type="link"
          size="small"
          @click="handleReplace(row)"
        >
          替换
        </Button>
        <Button
          v-access:code="['assets-masks.download']"
          type="link"
          size="small"
          @click="handleDownload(row)"
        >
          下载
        </Button>
        <Button
          v-access:code="['assets-masks.delete']"
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
    <MaskOverlayModal ref="overlayModalRef" />
  </Page>
</template>
