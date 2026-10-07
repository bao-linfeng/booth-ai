<script setup lang="ts">
import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { getSignInConfigApi, updateSignInConfigApi } from '#/api/core/credits';

const submitting = ref(false);

const [SignInConfigForm, formApi] = useVbenForm({
  handleSubmit: async (values: Record<string, any>) => {
    if (submitting.value) return;
    submitting.value = true;
    try {
      modalApi.setState({ confirmLoading: true });
      await updateSignInConfigApi({
        enabled: values.enabled,
        dailyAmount: values.dailyAmount,
        timezone: values.timezone,
      });
      message.success('保存成功');
      modalApi.close();
    } catch (error) {
      console.error(error);
    } finally {
      submitting.value = false;
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Switch',
      fieldName: 'enabled',
      label: '启用签到',
    },
    {
      component: 'InputNumber',
      fieldName: 'dailyAmount',
      label: '每日积分',
      rules: 'required',
      componentProps: {
        min: 1,
        max: 10_000,
        precision: 0,
        placeholder: '请输入1-10000的整数',
        class: 'w-full',
      },
    },
    {
      component: 'Select',
      fieldName: 'timezone',
      label: '时区',
      rules: 'required',
      componentProps: {
        options: [
          { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
          { label: 'Asia/Chongqing', value: 'Asia/Chongqing' },
          { label: 'UTC', value: 'UTC' },
        ],
        allowClear: false,
        class: 'w-full',
      },
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
  title: '签到配置',
});

const open = async () => {
  if (submitting.value) return;
  modalApi.open();
  modalApi.setState({ loading: true });
  try {
    const config = await getSignInConfigApi();
    formApi.setValues(config);
  } catch (error) {
    console.error(error);
    message.error('获取配置失败');
  } finally {
    modalApi.setState({ loading: false });
  }
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-120">
    <SignInConfigForm />
  </Modal>
</template>
