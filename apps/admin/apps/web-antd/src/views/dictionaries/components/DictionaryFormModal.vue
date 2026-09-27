<script setup lang="ts">
import { ref } from 'vue';
import { useVbenModal } from '@vben/common-ui';
import { message } from 'ant-design-vue';
import { useVbenForm } from '#/adapter/form';
import { createDictionaryApi, updateDictionaryApi, type DictionaryRecord } from '#/api/core/dictionaries';

const emit = defineEmits(['reload']);
const type = ref<'新增' | '编辑'>('新增');
const currentId = ref<string>('');

const [Form, formApi] = useVbenForm({
  handleSubmit: async (values) => {
    try {
      modalApi.setState({ confirmLoading: true });
      const payload = { ...values };
      if (type.value === '新增') {
        await createDictionaryApi(payload as any);
        message.success('新建字典成功');
      } else {
        await updateDictionaryApi(currentId.value, payload as any);
        message.success('更新字典成功');
      }
      modalApi.close();
      emit('reload');
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Input',
      fieldName: 'code',
      label: '字典编码',
      rules: 'required',
      componentProps: { placeholder: '请输入字典编码' },
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: '字典名称',
      rules: 'required',
      componentProps: { placeholder: '请输入字典名称' },
    },
    {
      component: 'Input',
      fieldName: 'type',
      label: '字典类型',
      rules: 'required',
      componentProps: { placeholder: '类型标记，如：尺寸、开口' },
    },
    {
      component: 'Textarea',
      fieldName: 'description',
      label: '描述',
      componentProps: { placeholder: '请输入描述', rows: 3 },
    },
    {
      component: 'Switch',
      fieldName: 'enabled',
      label: '状态',
      defaultValue: true,
      componentProps: {
        checkedChildren: '启用',
        unCheckedChildren: '禁用',
      },
    },
    {
      component: 'InputNumber',
      fieldName: 'sortOrder',
      label: '排序',
      defaultValue: 0,
      componentProps: { placeholder: '请输入排序值', class: 'w-full' },
    },
  ],
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await formApi.validateAndSubmitForm();
  },
  onCancel: () => {
    modalApi.close();
  },
});

const open = async (row?: DictionaryRecord) => {
  modalApi.open();
  formApi.resetForm();
  if (row) {
    type.value = '编辑';
    currentId.value = row.id;
    modalApi.setState({ title: '编辑字典' });
    
    formApi.updateSchema([
      {
        fieldName: 'code',
        componentProps: { disabled: true },
      },
    ]);
    formApi.setValues({ ...row });
  } else {
    type.value = '新增';
    currentId.value = '';
    modalApi.setState({ title: '新建字典' });
    
    formApi.updateSchema([
      {
        fieldName: 'code',
        componentProps: { disabled: false },
      },
    ]);
  }
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-120">
    <Form />
  </Modal>
</template>
