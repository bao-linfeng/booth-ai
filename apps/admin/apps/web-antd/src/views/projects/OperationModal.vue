<script setup lang="ts">
import type {
  FollowUp,
  ProjectDetail,
  ProjectStatus,
} from '#/api/core/projects';

import { nextTick, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  assignProjectApi,
  followUpApi,
  getAssigneesApi,
  linkSchemeApi,
  statusLabels,
} from '#/api/core/projects';
const emit = defineEmits<{ reload: [] }>();
const project = ref<ProjectDetail>();
const mode = ref<'assignment' | 'follow-up' | 'scheme'>('follow-up');
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
      else {
        const input: FollowUp = {
          ...change,
          contactMethod: String(values.contactMethod),
          contactedAt: new Date(String(values.contactedAt)).toISOString(),
          content: String(values.content),
        };
        if (values.targetStatus)
          input.targetStatus = values.targetStatus as ProjectStatus;
        if (values.nextFollowUpAt)
          input.nextFollowUpAt = new Date(
            String(values.nextFollowUpAt),
          ).toISOString();
        if (values.outcome) input.outcome = String(values.outcome);
        if (values.reopenReason)
          input.reopenReason = String(values.reopenReason);
        if (values.publicResult !== undefined && values.publicResult !== null)
          input.publicResult = String(values.publicResult);
        if (input.targetStatus === 'quoted') {
          const sentAt = new Date(String(values.sentAt)).toISOString();
          const channel = String(values.channel);
          input.quoteEvidence =
            values.evidenceType === 'platform'
              ? {
                  type: 'platform',
                  quotationRevision: Number(values.quotationRevision),
                  sentAt,
                  channel,
                }
              : {
                  type: 'external_manual',
                  reference: String(values.reference ?? ''),
                  sentAt,
                  channel,
                };
        }
        await followUpApi(record.projectId, input);
      }
      message.success('项目记录已保存');
      modalApi.close();
      emit('reload');
    } catch {
      message.error(
        '保存未确认。草稿已保留；如项目已更新，请刷新比较后重新操作。',
      );
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
async function open(record: ProjectDetail, operation: typeof mode.value) {
  project.value = record;
  mode.value = operation;
  key = '';
  fingerprint = '';
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
          rules: 'required',
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
    formApi.setState({
      schema: [
        {
          component: 'Select',
          fieldName: 'contactMethod',
          label: '联系类型',
          rules: 'required',
          componentProps: {
            options: [
              { value: 'phone', label: '电话' },
              { value: 'email', label: '邮件' },
              { value: 'customer_service', label: '客服' },
              { value: 'meeting', label: '会议' },
              { value: 'other', label: '其他' },
            ],
          },
        },
        {
          component: 'DatePicker',
          fieldName: 'contactedAt',
          label: '联系时间',
          rules: 'required',
          componentProps: {
            showTime: true,
            valueFormat: 'YYYY-MM-DDTHH:mm:ssZ',
          },
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
          componentProps: {
            showTime: true,
            valueFormat: 'YYYY-MM-DDTHH:mm:ssZ',
          },
        },
        {
          component: 'Select',
          fieldName: 'targetStatus',
          label: '目标状态（选填）',
          componentProps: {
            allowClear: true,
            options: Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            })),
          },
        },
        {
          component: 'Textarea',
          fieldName: 'outcome',
          label: '成交结果 / 未成交或关闭原因',
          componentProps: { rows: 2, maxlength: 5000 },
        },
        {
          component: 'Textarea',
          fieldName: 'reopenReason',
          label: '终态重开原因',
          componentProps: { maxlength: 2000 },
        },
        {
          component: 'Textarea',
          fieldName: 'publicResult',
          label: '客户可见结果（明确发布）',
          componentProps: { rows: 2, maxlength: 5000 },
        },
        {
          component: 'Select',
          fieldName: 'evidenceType',
          label: '已发送报价依据',
          componentProps: {
            options: [
              { value: 'platform', label: '平台报价修订' },
              { value: 'external_manual', label: '外部人工报价' },
            ],
          },
        },
        {
          component: 'InputNumber',
          fieldName: 'quotationRevision',
          label: '已发送平台修订',
          componentProps: { min: 1, precision: 0 },
        },
        {
          component: 'Input',
          fieldName: 'reference',
          label: '外部报价编号 / 说明',
        },
        {
          component: 'DatePicker',
          fieldName: 'sentAt',
          label: '报价发送时间',
          componentProps: {
            showTime: true,
            valueFormat: 'YYYY-MM-DDTHH:mm:ssZ',
          },
        },
        { component: 'Input', fieldName: 'channel', label: '报价发送渠道' },
      ],
    });
    await formApi.setValues({
      contactMethod: 'phone',
      contactedAt: new Date().toISOString(),
      publicResult: record.publicResult ?? '',
      evidenceType: 'platform',
      quotationRevision: record.quotation?.revision,
      sentAt: new Date().toISOString(),
      channel: 'email',
    });
  }
}
defineExpose({ open });
</script>
<template>
  <Modal class="w-[720px]">
    <p class="mb-4 text-sm text-muted-foreground">
      项目修订
      {{
        project?.revision
      }}。终态仅可追加说明或填写原因重开；已报价需填写发送依据。
    </p>
    <Form />
  </Modal>
</template>
