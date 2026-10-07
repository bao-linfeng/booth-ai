<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';
import type { ProjectDetail, ProjectStatus } from '#/api/core/projects';

import { computed, nextTick, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Alert, Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  assignProjectApi,
  followUpApi,
  getAssigneesApi,
  getProjectApi,
  linkSchemeApi,
  statusLabels,
} from '#/api/core/projects';

import { buildFollowUp } from './follow-up';
import {
  contactMethodLabels,
  failureReason,
  operationFailureMessage,
  outcomeLabels,
  terminalStatuses,
} from './presentation';

const emit = defineEmits<{ reload: [] }>();
const project = ref<ProjectDetail>();
const mode = ref<'assignment' | 'follow-up' | 'scheme'>('follow-up');
const failure = ref('');
const conflict = ref(false);
const refreshing = ref(false);
const terminal = computed(
  () => !!project.value && terminalStatuses.includes(project.value.status),
);
let key = '';
let fingerprint = '';
const [Form, formApi] = useVbenForm({
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [],
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
      const change = { requestKey: key, expectedRevision: record.revision };
      if (mode.value === 'assignment')
        await assignProjectApi(record.projectId, {
          ...change,
          assigneeAdminId: String(values.assigneeAdminId),
          reason: String(values.reason),
        });
      else if (mode.value === 'scheme')
        await linkSchemeApi(record.projectId, {
          ...change,
          schemeCode: String(values.schemeCode),
          confirmationNote: String(values.confirmationNote),
        });
      else
        await followUpApi(
          record.projectId,
          buildFollowUp(record, values, change),
        );
      message.success('项目记录已保存');
      modalApi.close();
      emit('reload');
    } catch (error) {
      const reason = failureReason(error);
      failure.value = operationFailureMessage(error);
      conflict.value =
        reason === 'PROJECT_REVISION_CHANGED' ||
        reason === 'INVALID_STATUS_TRANSITION';
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

function statusOptions(record: ProjectDetail) {
  const reopening = terminalStatuses.includes(record.status);
  return record.statusTransitions.map((status) => ({
    value: status,
    label: reopening
      ? `重开为「${statusLabels[status]}」`
      : statusLabels[status],
  }));
}

function quotationHelp(record: ProjectDetail) {
  const quotation = record.quotation;
  if (!quotation) return '项目还没有平台报价修订，只能登记外部人工报价。';
  return quotation.completeness === 'ready'
    ? `最新修订 r${quotation.revision}，有效期至 ${quotation.validUntil}。`
    : `最新修订 r${quotation.revision} 未填写完整，不能作为发送依据；请选择更早的完整修订或先补全报价。`;
}

function followUpSchema(record: ProjectDetail): VbenFormSchema[] {
  const target = (values: Record<string, unknown>) =>
    values.targetStatus as ProjectStatus | undefined;
  const quoted = (values: Record<string, unknown>) =>
    target(values) === 'quoted';
  return [
    {
      component: 'Select',
      fieldName: 'contactMethod',
      label: '联系类型',
      rules: 'selectRequired',
      componentProps: {
        options: Object.entries(contactMethodLabels).map(([value, label]) => ({
          value,
          label,
        })),
      },
    },
    {
      component: 'DatePicker',
      fieldName: 'contactedAt',
      label: '联系时间',
      rules: 'required',
      componentProps: { showTime: true, valueFormat: 'YYYY-MM-DDTHH:mm:ssZ' },
    },
    {
      component: 'Textarea',
      fieldName: 'content',
      label: '内部跟进内容',
      rules: 'required',
      componentProps: { rows: 4, maxlength: 5000 },
    },
    {
      component: 'DatePicker',
      fieldName: 'nextFollowUpAt',
      label: '下次跟进',
      componentProps: { showTime: true, valueFormat: 'YYYY-MM-DDTHH:mm:ssZ' },
    },
    {
      component: 'Select',
      fieldName: 'targetStatus',
      label: terminalStatuses.includes(record.status) ? '重开项目' : '变更状态',
      help: terminalStatuses.includes(record.status)
        ? '项目已结束：不选择即仅追加说明；需要继续跟进时重开并填写原因。'
        : undefined,
      componentProps: {
        allowClear: true,
        placeholder: `保持「${statusLabels[record.status]}」`,
        options: statusOptions(record),
      },
    },
    {
      component: 'Textarea',
      fieldName: 'outcome',
      label: '结果 / 原因',
      componentProps: { rows: 2, maxlength: 5000 },
      dependencies: {
        triggerFields: ['targetStatus'],
        resolve: ({ values }) => {
          const status = target(values);
          const label = status && outcomeLabels[status];
          return {
            show: !!label,
            rules: 'required',
            componentProps: label ? { placeholder: `填写${label}` } : {},
          };
        },
      },
    },
    {
      component: 'Textarea',
      fieldName: 'reopenReason',
      label: '重开原因',
      componentProps: { rows: 2, maxlength: 2000 },
      dependencies: {
        triggerFields: ['targetStatus'],
        resolve: ({ values }) => ({
          show:
            terminalStatuses.includes(record.status) &&
            target(values) === 'following',
          rules: 'required',
        }),
      },
    },
    {
      component: 'RadioGroup',
      fieldName: 'evidenceType',
      label: '报价依据',
      componentProps: {
        optionType: 'button',
        options: [
          {
            value: 'platform',
            label: '平台报价修订',
            disabled: !record.quotation,
          },
          { value: 'external_manual', label: '外部人工报价' },
        ],
      },
      dependencies: {
        triggerFields: ['targetStatus'],
        resolve: ({ values }) => ({
          show: quoted(values),
          rules: 'selectRequired',
        }),
      },
    },
    {
      component: 'InputNumber',
      fieldName: 'quotationRevision',
      label: '已发送的报价修订',
      help: quotationHelp(record),
      componentProps: { min: 1, precision: 0, addonBefore: 'r' },
      dependencies: {
        triggerFields: ['targetStatus', 'evidenceType'],
        resolve: ({ values }) => ({
          show: quoted(values) && values.evidenceType === 'platform',
          rules: 'required',
        }),
      },
    },
    {
      component: 'Input',
      fieldName: 'reference',
      label: '外部报价编号 / 说明',
      componentProps: { maxlength: 500 },
      dependencies: {
        triggerFields: ['targetStatus', 'evidenceType'],
        resolve: ({ values }) => ({
          show: quoted(values) && values.evidenceType === 'external_manual',
          rules: 'required',
        }),
      },
    },
    {
      component: 'DatePicker',
      fieldName: 'sentAt',
      label: '报价发送时间',
      componentProps: { showTime: true, valueFormat: 'YYYY-MM-DDTHH:mm:ssZ' },
      dependencies: {
        triggerFields: ['targetStatus'],
        resolve: ({ values }) => ({ show: quoted(values), rules: 'required' }),
      },
    },
    {
      component: 'Input',
      fieldName: 'channel',
      label: '报价发送渠道',
      componentProps: { maxlength: 100, placeholder: '如：邮件、微信' },
      dependencies: {
        triggerFields: ['targetStatus'],
        resolve: ({ values }) => ({ show: quoted(values), rules: 'required' }),
      },
    },
    {
      component: 'Textarea',
      fieldName: 'publicResult',
      label: '客户可见结果',
      help: '修改后提交即对客户公开；不修改则保持当前公开内容。',
      componentProps: { rows: 2, maxlength: 5000 },
    },
  ];
}

async function open(record: ProjectDetail, operation: typeof mode.value) {
  project.value = record;
  mode.value = operation;
  key = '';
  fingerprint = '';
  failure.value = '';
  conflict.value = false;
  modalApi.setState({
    title: {
      assignment: '改派承接人',
      'follow-up': '追加跟进与状态记录',
      scheme: '确认关联方案',
    }[operation],
  });
  modalApi.open();
  await nextTick();
  await formApi.reset();
  if (operation === 'assignment') {
    const admins = await getAssigneesApi();
    formApi.setState({
      schema: [
        {
          component: 'Select',
          fieldName: 'assigneeAdminId',
          label: '承接管理员',
          rules: 'selectRequired',
          componentProps: {
            options: admins.map((admin) => ({
              value: admin.id,
              label: admin.name,
            })),
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
    });
    await formApi.setValues({ assigneeAdminId: record.assigneeAdminId });
  } else if (operation === 'scheme') {
    formApi.setState({
      schema: [
        {
          component: 'Input',
          fieldName: 'schemeCode',
          label: '已确认方案编号',
          rules: 'required',
        },
        {
          component: 'Textarea',
          fieldName: 'confirmationNote',
          label: '客户确认依据',
          rules: 'required',
          componentProps: { maxlength: 2000, rows: 4 },
        },
      ],
    });
  } else {
    formApi.setState({ schema: followUpSchema(record) });
    await formApi.setValues({
      contactMethod: 'phone',
      contactedAt: new Date().toISOString(),
      publicResult: record.publicResult ?? '',
      evidenceType:
        record.quotation?.completeness === 'ready'
          ? 'platform'
          : 'external_manual',
      quotationRevision: record.quotation?.revision,
      sentAt: new Date().toISOString(),
      channel: '邮件',
    });
  }
}

/** 版本冲突后载入最新修订：保留已填内容，只更新与状态相关的选项。 */
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
    if (mode.value === 'follow-up') {
      const values = await formApi.getValues();
      formApi.setState({ schema: followUpSchema(latest) });
      if (
        values.targetStatus &&
        !latest.statusTransitions.includes(values.targetStatus as ProjectStatus)
      )
        await formApi.setFieldValue('targetStatus', undefined);
    }
    emit('reload');
  } finally {
    refreshing.value = false;
  }
}
defineExpose({ open });
</script>
<template>
  <Modal class="w-[720px]">
    <p v-if="project" class="mb-4 text-sm text-muted-foreground">
      当前状态「{{ statusLabels[project.status] }}」 · 修订 r{{
        project.revision
      }}
      · 更新于 {{ formatDateTime(project.updatedAt) }}
      <template v-if="mode === 'follow-up' && terminal">
        · 项目已结束，可追加说明或重开
      </template>
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
  </Modal>
</template>
