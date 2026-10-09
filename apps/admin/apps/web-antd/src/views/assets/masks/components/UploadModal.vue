<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import type { ImageSize } from '../../shared/image-spec';

import { h, markRaw, ref, watch } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { listSchemeAssetsApi, uploadAssetApi } from '#/api/core/assets';

import {
  formatImageSize,
  maskSizeError,
  readImageSize,
  versionImageSize,
} from '../../shared/image-spec';
import { useSchemeOptions } from '../../shared/scheme-filter';

const emit = defineEmits(['reload']);

const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();
const renderingOptions = ref<
  { disabled: boolean; label: string; value: string }[]
>([]);
const renderingSizes = new Map<string, ImageSize | null>();
const renderingLoading = ref(false);

/** 返回文件不满足配对效果图尺寸时的原因；尚未选择效果图时不校验。 */
async function fileSizeError(
  file: Blob,
  renderingId: string | undefined,
): Promise<string | undefined> {
  const size = await readImageSize(file);
  if (!renderingId) return undefined;
  return maskSizeError(size, renderingSizes.get(renderingId) ?? null);
}

async function fetchRenderings(code: string) {
  renderingLoading.value = true;
  try {
    const assets = await listSchemeAssetsApi(code, 'rendering');
    renderingSizes.clear();
    renderingOptions.value = assets.map((a) => {
      const size = versionImageSize(a.currentVersion);
      renderingSizes.set(a.id, size);
      return {
        disabled: !size,
        label: `${a.name}（${size ? formatImageSize(size) : '未上传文件'}）`,
        value: a.id,
      };
    });
  } catch {
    renderingOptions.value = [];
  } finally {
    renderingLoading.value = false;
  }
}

watch(schemeCode, (code) => {
  renderingOptions.value = [];
  formApi.setFieldValue('relatedAssetId', undefined);
  if (code) fetchRenderings(code);
});

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  layout: 'vertical',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Select' as const,
      fieldName: 'relatedAssetId',
      label: '配对效果图',
      rules: 'required',
      componentProps: () => ({
        options: renderingOptions.value,
        loading: renderingLoading.value,
        placeholder: '请先选择归属方案，再选择配对效果图',
        allowClear: true,
        notFoundContent: schemeCode.value
          ? '该方案暂无效果图'
          : '请先选择归属方案',
      }),
    },
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '资源名称',
      rules: 'required',
      componentProps: { placeholder: '请输入资源名称' },
    },
    {
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.png,.jpg,.jpeg,.webp',
        beforeUpload: async (
          file: File,
        ): Promise<boolean | typeof Upload.LIST_IGNORE> => {
          try {
            const { relatedAssetId } = await formApi.getValues();
            const error = await fileSizeError(file, relatedAssetId);
            if (!error) return false;
            message.error(error);
          } catch (error) {
            message.error((error as Error).message);
          }
          return Upload.LIST_IGNORE;
        },
        maxCount: 1,
      },
      renderComponentContent: () => ({
        default: () =>
          h('div', [
            h('p', { class: 'ant-upload-drag-icon' }, [
              h(IconifyIcon, {
                icon: 'ant-design:inbox-outlined',
                class: 'mx-auto size-10 text-primary',
              }),
            ]),
            h('p', { class: 'ant-upload-text' }, '点击或拖拽文件到此区域上传'),
            h(
              'p',
              { class: 'ant-upload-hint' },
              '像素尺寸需与配对效果图一致，支持 png, jpg, webp 格式（PNG 推荐）',
            ),
          ]),
      }),
    },
  ],
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    if (!schemeCode.value) {
      message.error('请选择归属方案');
      return;
    }

    const { valid } = await formApi.validate();
    if (!valid) return;

    const values = await formApi.getValues();
    const fileList = values.file as undefined | UploadFile[];
    const file = fileList?.[0]?.originFileObj;
    if (!file) {
      message.error('请选择文件');
      return;
    }
    // 选文件后可能又改了配对效果图，提交前按最终配对再校验一次
    try {
      const error = await fileSizeError(file, values.relatedAssetId);
      if (error) {
        message.error(error);
        return;
      }
    } catch (error) {
      message.error((error as Error).message);
      return;
    }

    try {
      modalApi.setState({ confirmLoading: true });
      await uploadAssetApi(schemeCode.value, {
        type: 'mask',
        name: values.name,
        file: file as File,
        relatedAssetId: values.relatedAssetId,
      });
      message.success('上传成功');
      modalApi.close();
      emit('reload');
    } catch (error) {
      console.error(error);
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  onOpenChange: (isOpen) => {
    if (isOpen) {
      schemes.search();
    } else {
      schemeCode.value = undefined;
      schemes.clear();
      renderingOptions.value = [];
      renderingSizes.clear();
      formApi.resetForm();
    }
  },
});

function open(defaultSchemeCode?: string) {
  schemeCode.value = defaultSchemeCode;
  schemes.pin(defaultSchemeCode);
  modalApi.open();
}
defineExpose({ open });
</script>

<template>
  <Modal class="w-[520px]" title="上传蒙版">
    <div class="px-4 pb-2">
      <div class="mb-4">
        <label class="mb-1 block text-sm font-medium">归属方案</label>
        <Select
          v-model:value="schemeCode"
          :options="schemes.options.value"
          :loading="schemes.loading.value"
          show-search
          :filter-option="false"
          allow-clear
          placeholder="搜索方案编号或名称"
          class="w-full"
          @search="schemes.onSearch"
        />
      </div>
      <Form />
    </div>
  </Modal>
</template>
