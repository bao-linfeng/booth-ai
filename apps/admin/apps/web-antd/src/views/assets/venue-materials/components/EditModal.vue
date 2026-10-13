<script setup lang="ts">
import type { DrawingViewCode } from '../drawing-views';

import type { SchemeAsset } from '#/api/core/assets';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { updateAssetApi } from '#/api/core/assets';

import {
  buildDrawingMetadata,
  readViewCodes,
  VIEW_CODE_HINT,
  VIEW_CODE_OPTIONS,
} from '../drawing-views';

const emit = defineEmits(['reload']);

const asset = ref<null | SchemeAsset>(null);

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  layout: 'vertical',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  handleSubmit: async (values: Record<string, any>) => {
    const target = asset.value;
    if (!target) return;
    modalApi.setState({ confirmLoading: true });
    try {
      await updateAssetApi(target.schemeCode, target.id, {
        name: String(values.name).trim(),
        metadata: buildDrawingMetadata(
          (values.viewCodes ?? []) as DrawingViewCode[],
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
      componentProps: { maxlength: 500, placeholder: '请输入资源名称' },
    },
    {
      component: 'CheckboxGroup',
      fieldName: 'viewCodes',
      label: '视向',
      help: VIEW_CODE_HINT,
      componentProps: { options: VIEW_CODE_OPTIONS },
    },
  ],
});

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
    viewCodes: readViewCodes(target.metadata),
  });
  modalApi.open();
}
defineExpose({ open });
</script>

<template>
  <Modal class="w-[480px]" title="编辑报馆图">
    <div class="px-4 pb-2">
      <Form />
    </div>
  </Modal>
</template>
