<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import { h, markRaw, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { uploadAssetApi } from '#/api/core/assets';

import { useSchemeOptions } from '../../shared/scheme-filter';
import { createUploadKey } from '../../shared/upload-key';

const emit = defineEmits(['reload']);

const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();
const uploadKey = createUploadKey();

const DIMENSION_UNIT_OPTIONS = [
  { label: 'mm（毫米）', value: 'mm' },
  { label: 'cm（厘米）', value: 'cm' },
  { label: 'm（米）', value: 'm' },
];

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  layout: 'vertical',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '资源名称',
      rules: 'required',
      componentProps: { placeholder: '请输入资源名称' },
    },
    {
      component: 'Input' as const,
      fieldName: 'artworkKey',
      label: '画面键',
      rules: 'required',
      componentProps: { placeholder: '如：wall_a、wall_b（英文）' },
    },
    {
      component: 'Input' as const,
      fieldName: 'wallPosition',
      label: '墙面位置',
      componentProps: { placeholder: '如：正面左墙' },
    },
    {
      component: 'InputNumber' as const,
      fieldName: 'physicalWidth',
      label: '物理宽度',
      componentProps: { placeholder: '宽', min: 0.01, class: 'w-full' },
    },
    {
      component: 'InputNumber' as const,
      fieldName: 'physicalHeight',
      label: '物理高度',
      componentProps: { placeholder: '高', min: 0.01, class: 'w-full' },
    },
    {
      component: 'Select' as const,
      fieldName: 'dimensionUnit',
      label: '尺寸单位',
      componentProps: {
        options: DIMENSION_UNIT_OPTIONS,
        placeholder: '请选择单位',
        allowClear: true,
      },
    },
    {
      component: 'Textarea' as const,
      fieldName: 'dimensionEvidence',
      label: '尺寸依据',
      componentProps: { placeholder: '请填写尺寸来源或测量依据', rows: 2 },
    },
    {
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.png,.jpg,.jpeg,.webp',
        beforeUpload: () => false,
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
            h('p', { class: 'ant-upload-hint' }, '支持图片格式（PNG 推荐）'),
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
    const uploadedFileList = values.file as undefined | UploadFile[];
    const file = uploadedFileList?.[0]?.originFileObj;
    if (!file) {
      message.error('请选择文件');
      return;
    }
    try {
      modalApi.setState({ confirmLoading: true });
      const metadata: Record<string, unknown> = {
        artworkKey: values.artworkKey,
      };
      if (values.wallPosition) metadata.wallPosition = values.wallPosition;
      if (values.physicalWidth !== null && values.physicalWidth !== undefined)
        metadata.physicalWidth = values.physicalWidth;
      if (values.physicalHeight !== null && values.physicalHeight !== undefined)
        metadata.physicalHeight = values.physicalHeight;
      if (values.dimensionUnit) metadata.dimensionUnit = values.dimensionUnit;
      if (values.dimensionEvidence)
        metadata.dimensionEvidence = values.dimensionEvidence;
      await uploadAssetApi(schemeCode.value, {
        type: 'artwork',
        name: values.name,
        file: file as File,
        idempotencyKey: uploadKey.forFile(file as File),
        metadata: JSON.stringify(metadata),
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
      uploadKey.renew();
      schemes.search();
    } else {
      schemeCode.value = undefined;
      schemes.clear();
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
  <Modal class="w-[520px]" title="上传平面素材">
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
