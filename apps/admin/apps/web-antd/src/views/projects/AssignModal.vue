<script setup lang="ts">
import type { Project } from '#/api/core/projects';

import { computed, nextTick, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  assignProjectApi,
  getAssigneesApi,
  getProjectApi,
} from '#/api/core/projects';

import { failureReason, operationFailureMessage } from './presentation';

/** 分配 / 改派承接人：列表与详情页共用，成功后通过 reload 事件通知父页面刷新。 */
type Target = Pick<Project, 'assigneeAdminId' | 'projectId' | 'revision'>;

const emit = defineEmits<{ reload: [] }>();
const project = ref<Target>();
const failure = ref('');
const conflict = ref(false);
const refreshing = ref(false);
const unassigned = computed(() => !project.value?.assigneeAdminId);
let key = '';
let fingerprint = '';

const [Form, formApi] = useVbenForm({
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Select',
      fieldName: 'assigneeAdminId',
      label: '承接管理员',
      rules: 'selectRequired',
      componentProps: {
        options: [],
        optionFilterProp: 'label',
        showSearch: true,
      },
    },
    {
      component: 'Textarea',
      fieldName: 'reason',
      label: '分配原因',
      rules: 'required',
      componentProps: { maxlength: 2000, rows: 3 },
    },
  ],
  handleSubmit: async (values: Record<string, unknown>) => {
    if (!project.value) return;
    const record = project.value;
    const payload = JSON.stringify(values);
    if (fingerprint !== payload) {
      key = crypto.randomUUID();
      fingerprint = payload;
    }
    failure.value = '';
    conflict.value = false;
    modalApi.setState({ confirmLoading: true });
    try {
      await assignProjectApi(record.projectId, {
        requestKey: key,
        expectedRevision: record.revision,
        assigneeAdminId: String(values.assigneeAdminId),
        reason: String(values.reason),
      });
      message.success(unassigned.value ? '已分配承接人' : '已改派承接人');
      modalApi.close();
      emit('reload');
    } catch (error) {
      failure.value = operationFailureMessage(error);
      conflict.value = failureReason(error) === 'PROJECT_REVISION_CHANGED';
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
  conflict.value = false;
  modalApi.setState({
    title: record.assigneeAdminId ? '改派承接人' : '分配承接人',
  });
  modalApi.open();
  await nextTick();
  await formApi.resetForm();
  const admins = await getAssigneesApi();
  formApi.updateSchema([
    {
      fieldName: 'assigneeAdminId',
      componentProps: {
        options: admins.map((admin) => ({
          value: admin.id,
          label: admin.name,
        })),
      },
    },
  ]);
  if (record.assigneeAdminId)
    await formApi.setValues({ assigneeAdminId: record.assigneeAdminId });
}

/** 列表中的修订号可能已过期：冲突后载入最新修订，保留已填内容。 */
async function loadLatest() {
  if (!project.value) return;
  refreshing.value = true;
  try {
    const latest = await getProjectApi(project.value.projectId);
    project.value = latest;
    key = '';
    fingerprint = '';
    failure.value = '';
    conflict.value = false;
    emit('reload');
  } finally {
    refreshing.value = false;
  }
}

defineExpose({ open });
</script>
<template>
  <Modal class="w-[560px]">
    <p v-if="unassigned" class="mb-4 text-sm text-muted-foreground">
      项目在待分配池中，分配后承接人才能跟进、报价和关联方案。
    </p>
    <Alert
      v-if="failure"
      class="mb-4"
      type="error"
      show-icon
      :message="failure"
    >
      <template v-if="conflict" #action>
        <Button size="small" :loading="refreshing" @click="loadLatest">
          载入最新修订
        </Button>
      </template>
    </Alert>
    <Form />
    <p class="mt-2 text-sm text-muted-foreground">
      仅可选择已启用且具备项目查看和跟进权限的人员；分配给他人时，对方会收到一条只有本人可见的通知。
    </p>
  </Modal>
</template>
