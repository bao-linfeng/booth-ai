<script setup lang="ts">
import type { Project } from '#/api/core/projects';

import { nextTick, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { updatePublicResultApi } from '#/api/core/projects';

import { operationFailureMessage } from './presentation';

/** 更新客户可见结果：独立于跟进，终态项目也可修改，提交后客户在「我的项目」中可见。 */
type Target = Pick<Project, 'projectId' | 'publicResult' | 'revision'>;

const emit = defineEmits<{ reload: [] }>();
const project = ref<Target>();
const failure = ref('');
let key = '';
let fingerprint = '';

const [Form, formApi] = useVbenForm({
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Textarea',
      fieldName: 'publicResult',
      label: '客户可见进度',
      help: '清空后提交表示撤下当前公开内容。',
      componentProps: { maxlength: 5000, rows: 4 },
    },
  ],
  handleSubmit: async (values: Record<string, unknown>) => {
    if (!project.value) return;
    const publicResult = String(values.publicResult ?? '');
    if (fingerprint !== publicResult) {
      key = crypto.randomUUID();
      fingerprint = publicResult;
    }
    failure.value = '';
    modalApi.setState({ confirmLoading: true });
    try {
      await updatePublicResultApi(project.value.projectId, {
        requestKey: key,
        expectedRevision: project.value.revision,
        publicResult,
      });
      message.success('客户进度已更新');
      modalApi.close();
      emit('reload');
    } catch (error) {
      failure.value = operationFailureMessage(error);
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async (): Promise<void> => {
    await formApi.validateAndSubmitForm();
  },
  onCancel: (): void => {
    modalApi.close();
  },
});

async function open(record: Target) {
  project.value = record;
  key = '';
  fingerprint = '';
  failure.value = '';
  modalApi.setState({ title: '更新客户进度', confirmText: '提交' });
  modalApi.open();
  await nextTick();
  await formApi.resetForm();
  await formApi.setValues({ publicResult: record.publicResult ?? '' });
}

defineExpose({ open });
</script>
<template>
  <Modal class="w-[560px]">
    <Alert
      class="mb-4"
      type="warning"
      show-icon
      message="提交后客户可见：内容会显示在客户的「我的项目」中，请勿填写内部备注。"
    />
    <Alert
      v-if="failure"
      class="mb-4"
      type="error"
      show-icon
      :message="failure"
    />
    <Form />
  </Modal>
</template>
