<script setup lang="ts">
import type { DimensionUnit } from '../artwork-metadata';

import type { SchemeAsset } from '#/api/core/assets';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { listSchemeAssetsApi, updateAssetApi } from '#/api/core/assets';

import {
  buildArtworkMetadata,
  DIMENSION_UNIT_OPTIONS,
  readArtworkFields,
  wallPositionOptions,
} from '../artwork-metadata';

const emit = defineEmits(['reload']);

const asset = ref<null | SchemeAsset>(null);

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  layout: 'vertical',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2',
  handleSubmit: async (values: Record<string, any>) => {
    const target = asset.value;
    if (!target) return;
    modalApi.setState({ confirmLoading: true });
    try {
      await updateAssetApi(target.schemeCode, target.id, {
        name: String(values.name).trim(),
        metadata: buildArtworkMetadata(
          {
            wallPosition: values.wallPosition,
            physicalWidth: values.physicalWidth,
            physicalHeight: values.physicalHeight,
            dimensionUnit: values.dimensionUnit as DimensionUnit,
          },
          target.metadata,
        ),
        expectedRevision: target.revision,
      });
      message.success('已保存');
      emit('reload');
      modalApi.close();
    } catch (error) {
      // 错误提示由请求拦截器按 reason 统一展示，保留表单以便修正后重试
      console.error(error);
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Input',
      fieldName: 'name',
      label: '资源名称',
      rules: 'required',
      formItemClass: 'col-span-2',
      componentProps: { maxlength: 500, placeholder: '请输入资源名称' },
    },
    {
      component: 'AutoComplete',
      fieldName: 'wallPosition',
      label: '墙面位置',
      formItemClass: 'col-span-2',
      componentProps: {
        options: wallPositionOptions([]),
        filterOption: (input: string, option: { value: string }) =>
          option.value.includes(input.trim()),
        placeholder: '如：正面左墙',
      },
    },
    {
      component: 'InputNumber',
      fieldName: 'physicalWidth',
      label: '物理宽度',
      componentProps: { min: 0.01, placeholder: '宽' },
    },
    {
      component: 'InputNumber',
      fieldName: 'physicalHeight',
      label: '物理高度',
      componentProps: { min: 0.01, placeholder: '高' },
    },
    {
      component: 'RadioGroup',
      fieldName: 'dimensionUnit',
      label: '尺寸单位',
      formItemClass: 'col-span-2',
      componentProps: {
        options: DIMENSION_UNIT_OPTIONS,
        optionType: 'button',
      },
    },
  ],
});

async function loadWallOptions(target: SchemeAsset) {
  try {
    const assets = await listSchemeAssetsApi(target.schemeCode, 'artwork');
    if (asset.value?.id !== target.id) return;
    formApi.updateSchema([
      {
        fieldName: 'wallPosition',
        componentProps: { options: wallPositionOptions(assets) },
      },
    ]);
  } catch (error) {
    console.error(error);
  }
}

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await formApi.validateAndSubmitForm();
  },
  onOpenChange: (isOpen) => {
    if (!isOpen) {
      asset.value = null;
      formApi.resetForm();
    }
  },
});

function open(target: SchemeAsset) {
  asset.value = target;
  formApi.setValues({
    name: target.name,
    ...readArtworkFields(target.metadata),
  });
  formApi.updateSchema([
    {
      fieldName: 'wallPosition',
      componentProps: { options: wallPositionOptions([]) },
    },
  ]);
  loadWallOptions(target);
  modalApi.open();
}
defineExpose({ open });
</script>

<template>
  <Modal class="w-[480px]" title="编辑平面素材">
    <div class="px-4 pb-2">
      <Form />
    </div>
  </Modal>
</template>
