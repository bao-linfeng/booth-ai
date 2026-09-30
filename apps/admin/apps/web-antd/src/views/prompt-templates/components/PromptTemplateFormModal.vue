<script setup lang="ts">
import type { PromptTemplate } from '#/api/core/prompt-templates';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createPromptTemplateApi,
  updatePromptTemplateApi,
} from '#/api/core/prompt-templates';
import { getSchemeOptionsApi } from '#/api/core/schemes';

const emit = defineEmits(['reload']);
const type = ref<'新增' | '编辑'>('新增');
const currentRevision = ref(0);
const currentId = ref('');

const [Form, formApi] = useVbenForm({
  handleSubmit: async (values) => {
    modalApi.setState({ confirmLoading: true });
    try {
      if (type.value === '新增') {
        await createPromptTemplateApi({
          purpose: values.purpose,
          industryId: values.industryId || null,
          styleId: values.styleId || null,
          body: values.body,
        });
      } else {
        await updatePromptTemplateApi(currentId.value, {
          body: values.body,
          expectedRevision: currentRevision.value,
        });
      }
      message.success(type.value === '新增' ? '创建成功' : '更新成功');
      emit('reload');
      modalApi.close();
    } catch (error: any) {
      if (error?.response?.status === 409) {
        message.error('版本冲突或该用途/行业/风格组合已存在启用模板');
      } else {
        message.error(type.value === '新增' ? '创建失败' : '更新失败');
      }
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Select',
      fieldName: 'purpose',
      label: '用途',
      rules: 'required',
      componentProps: {
        placeholder: '请选择',
        options: [
          { label: '换主题', value: 'theme' },
          { label: '四面图', value: 'artwork' },
        ],
        class: 'w-full',
      },
    },
    {
      component: 'Select',
      fieldName: 'industryId',
      label: '行业',
      componentProps: {
        placeholder: '留空表示通用（适用所有行业）',
        allowClear: true,
        options: [],
        class: 'w-full',
      },
    },
    {
      component: 'Select',
      fieldName: 'styleId',
      label: '风格',
      componentProps: {
        placeholder: '留空表示通用（适用所有风格）',
        allowClear: true,
        options: [],
        class: 'w-full',
      },
    },
    {
      component: 'Textarea',
      fieldName: 'body',
      label: '模板正文',
      rules: 'required',
      formItemClass: 'col-span-2',
      componentProps: {
        placeholder:
          '支持变量：{{brandColors}} {{brandKeywords}} {{industryLabel}} {{styleLabel}}',
        rows: 8,
        class: 'w-full font-mono text-sm',
      },
    },
  ],
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await formApi.validateAndSubmitForm();
  },
  onCancel: () => {
    modalApi.close();
  },
});

const open = async (row?: PromptTemplate) => {
  modalApi.open();
  formApi.resetForm();

  const res = await getSchemeOptionsApi();
  const industryOpts = (res.industry || []).map((o) => ({
    label: o.label,
    value: o.id,
  }));
  const styleOpts = (res.style || []).map((o) => ({
    label: o.label,
    value: o.id,
  }));

  if (row) {
    type.value = '编辑';
    currentId.value = row.id;
    currentRevision.value = row.revision;
    modalApi.setState({ title: '编辑模板' });
    formApi.updateSchema([
      { fieldName: 'purpose', componentProps: { disabled: true } },
      {
        fieldName: 'industryId',
        componentProps: { disabled: true, options: industryOpts },
      },
      {
        fieldName: 'styleId',
        componentProps: { disabled: true, options: styleOpts },
      },
    ]);
    formApi.setValues({
      purpose: row.purpose,
      industryId: row.industryId ?? '',
      styleId: row.styleId ?? '',
      body: row.body,
    });
  } else {
    type.value = '新增';
    modalApi.setState({ title: '新建模板' });
    formApi.updateSchema([
      { fieldName: 'purpose', componentProps: { disabled: false } },
      {
        fieldName: 'industryId',
        componentProps: { disabled: false, options: industryOpts },
      },
      {
        fieldName: 'styleId',
        componentProps: { disabled: false, options: styleOpts },
      },
    ]);
  }
};
defineExpose({ open });
</script>
<template>
  <Modal class="w-[700px]">
    <Form />
  </Modal>
</template>
