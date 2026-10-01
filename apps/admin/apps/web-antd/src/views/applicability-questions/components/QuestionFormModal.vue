<script setup lang="ts">
import type { ApplicabilityQuestion } from '#/api/core/applicability-questions';
import { ref } from 'vue';
import { useVbenModal } from '@vben/common-ui';
import { message } from 'ant-design-vue';
import { useVbenForm } from '#/adapter/form';
import { createQuestionApi, updateQuestionApi } from '#/api/core/applicability-questions';

const emit = defineEmits(['reload']);
const type = ref<'新增' | '编辑'>('新增');
const currentId = ref('');

const [Form, formApi] = useVbenForm({
  handleSubmit: async (values) => {
    modalApi.setState({ confirmLoading: true });
    try {
      if (type.value === '新增') {
        await createQuestionApi({
          id: values.id,
          label: values.label,
          helpText: values.helpText || '',
          sortOrder: values.sortOrder ?? 0,
        });
      } else {
        await updateQuestionApi(currentId.value, {
          label: values.label,
          helpText: values.helpText || '',
          sortOrder: values.sortOrder ?? 0,
        });
      }
      message.success(type.value === '新增' ? '创建成功' : '更新成功');
      emit('reload');
      modalApi.close();
    } catch (error: any) {
      if (error?.response?.status === 409) {
        message.error('该 ID 已存在');
      } else {
        message.error(type.value === '新增' ? '创建失败' : '更新失败');
      }
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Input',
      fieldName: 'id',
      label: 'ID',
      rules: 'required',
      componentProps: {
        placeholder: '如 outdoor_venue，创建后不可修改',
        class: 'w-full font-mono',
      },
    },
    {
      component: 'Input',
      fieldName: 'label',
      label: '问题文本',
      rules: 'required',
      componentProps: {
        placeholder: '展示给选型用户的问题',
        class: 'w-full',
      },
    },
    {
      component: 'Textarea',
      fieldName: 'helpText',
      label: '补充说明',
      componentProps: {
        placeholder: '帮助用户理解如何作答（可留空）',
        rows: 3,
        class: 'w-full',
      },
    },
    {
      component: 'InputNumber',
      fieldName: 'sortOrder',
      label: '排序',
      defaultValue: 0,
      componentProps: {
        min: 0,
        max: 9999,
        class: 'w-full',
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

const open = async (row?: ApplicabilityQuestion) => {
  modalApi.open();
  formApi.resetForm();
  if (row) {
    type.value = '编辑';
    currentId.value = row.id;
    modalApi.setState({ title: '编辑适用条件问题' });
    formApi.updateSchema([
      { fieldName: 'id', componentProps: { disabled: true } },
    ]);
    formApi.setValues({
      id: row.id,
      label: row.label,
      helpText: row.helpText,
      sortOrder: row.sortOrder,
    });
  } else {
    type.value = '新增';
    currentId.value = '';
    modalApi.setState({ title: '新建适用条件问题' });
    formApi.updateSchema([
      { fieldName: 'id', componentProps: { disabled: false } },
    ]);
  }
};

defineExpose({ open });
</script>
<template>
  <Modal class="w-[560px]">
    <Form />
  </Modal>
</template>