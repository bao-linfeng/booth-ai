<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';
import type {
  ProjectDetail,
  ProjectStatus,
  QuotationRevisionSummary,
} from '#/api/core/projects';

import { computed, nextTick, ref } from 'vue';

import { useAccess } from '@vben/access';
import { useVbenModal } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Alert, Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { listSchemeAssetsApi } from '#/api/core/assets';
import {
  followUpApi,
  getProjectApi,
  linkSchemeApi,
  quotationRevisionsApi,
  statusLabels,
} from '#/api/core/projects';
import { getSchemeListApi } from '#/api/core/schemes';

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
const mode = ref<'follow-up' | 'scheme'>('follow-up');
const failure = ref('');
const conflict = ref(false);
const refreshing = ref(false);
const terminal = computed(
  () => !!project.value && terminalStatuses.includes(project.value.status),
);
const { hasAccessByCodes } = useAccess();
/** 关联方案时选中的已发布方案摘要（缩略图取第一张效果图，无查看权限时为空） */
const pickedScheme = ref<{
  code: string;
  name: string;
  size: string;
  thumbnailUrl: null | string;
}>();
let schemeSearch: ReturnType<typeof setTimeout> | undefined;
let schemeQuery = 0;
const schemeSummaries = new Map<string, { name: string; size: string }>();
/** 可作为发送依据的完整报价修订（倒序） */
const readyRevisions = ref<QuotationRevisionSummary[]>([]);
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
      await (mode.value === 'scheme'
        ? linkSchemeApi(record.projectId, {
            ...change,
            schemeCode: String(values.schemeCode),
            confirmationNote: String(values.confirmationNote),
          })
        : followUpApi(record.projectId, buildFollowUp(record, values, change)));
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
  if (readyRevisions.value.length === 0)
    return record.quotation
      ? '还没有填写完整的报价修订，不能作为发送依据；请先补全报价或登记外部人工报价。'
      : '项目还没有平台报价修订，只能登记外部人工报价。';
  return '只列出填写完整的修订；发送时间需不早于修订创建时间且在有效期内。';
}

function revisionOptions() {
  return readyRevisions.value.map((revision) => ({
    value: revision.revision,
    label: `r${revision.revision} · ${revision.currency} ${revision.totalAmount ?? '—'} · 有效期至 ${revision.validUntil}`,
  }));
}

const contactOptions = Object.entries(contactMethodLabels).map(
  ([value, label]) => ({ value, label }),
);

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
      componentProps: { options: contactOptions },
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
            disabled: readyRevisions.value.length === 0,
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
      component: 'Select',
      fieldName: 'quotationRevision',
      label: '已发送的报价修订',
      help: quotationHelp(record),
      componentProps: { options: revisionOptions() },
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
      component: 'Select',
      fieldName: 'channel',
      label: '报价发送渠道',
      componentProps: { options: contactOptions },
      dependencies: {
        triggerFields: ['targetStatus'],
        resolve: ({ values }) => ({
          show: quoted(values),
          rules: 'selectRequired',
        }),
      },
    },
  ];
}

/** 待跟进项目默认预选"跟进中"（不做隐式状态推进，提交前可改） */
function defaultTarget(record: ProjectDetail) {
  return record.status === 'pending' &&
    record.statusTransitions.includes('following')
    ? 'following'
    : undefined;
}

async function loadRevisions(record: ProjectDetail) {
  try {
    const revisions = record.quotation
      ? await quotationRevisionsApi(record.projectId)
      : [];
    readyRevisions.value = revisions.filter(
      (revision) => revision.completeness === 'ready',
    );
  } catch {
    readyRevisions.value = [];
  }
}

/**
 * 打开操作弹窗；targetStatus 用于头部快捷按钮（开始跟进 / 标记成交等）预选目标状态，
 * 不在当前可选状态内时忽略。
 */
const metres = (mm: null | number) => (mm ? `${mm / 1000}` : '?');
/** 搜索已发布方案（编号或名称），结果填入下拉选项；连续输入只保留最后一次结果 */
async function searchSchemes(keyword: string) {
  const query = ++schemeQuery;
  try {
    const result = await getSchemeListApi({
      keyword: keyword.trim() || undefined,
      publishStatus: 'published',
      pageSize: 20,
    });
    if (query !== schemeQuery) return;
    for (const scheme of result.data)
      schemeSummaries.set(scheme.code, {
        name: scheme.name,
        size: `${metres(scheme.lengthMm)} × ${metres(scheme.widthMm)} m`,
      });
    formApi.updateSchema([
      {
        fieldName: 'schemeCode',
        componentProps: {
          options: result.data.map((scheme) => ({
            value: scheme.code,
            label: `${scheme.code} · ${scheme.name}`,
          })),
        },
      },
    ]);
  } catch {
    // 搜索失败保留现有选项，提示由请求拦截器统一弹出
  }
}
function onSchemeSearch(keyword: string) {
  clearTimeout(schemeSearch);
  schemeSearch = setTimeout(() => void searchSchemes(keyword), 300);
}
async function onSchemePicked(code: unknown) {
  const summary =
    typeof code === 'string' ? schemeSummaries.get(code) : undefined;
  if (typeof code !== 'string' || !summary) {
    pickedScheme.value = undefined;
    return;
  }
  pickedScheme.value = { code, ...summary, thumbnailUrl: null };
  if (!hasAccessByCodes(['assets-renderings.read'])) return;
  try {
    const renderings = await listSchemeAssetsApi(code, 'rendering');
    if (pickedScheme.value?.code === code)
      pickedScheme.value = {
        ...pickedScheme.value,
        thumbnailUrl:
          renderings.find((asset) => asset.thumbnailUrl)?.thumbnailUrl ?? null,
      };
  } catch {
    // 缩略图只是辅助确认，取不到时只显示名称
  }
}

/** 有方案查看权限时用已发布方案搜索下拉，否则退回手工输入方案编号 */
function schemeField(): VbenFormSchema {
  return hasAccessByCodes(['schemes.read'])
    ? {
        component: 'Select',
        fieldName: 'schemeCode',
        label: '已确认方案',
        rules: 'selectRequired',
        help: '只列出已发布的方案，可按编号或名称搜索',
        componentProps: {
          filterOption: false,
          options: [],
          placeholder: '输入方案编号或名称搜索',
          showSearch: true,
          onChange: onSchemePicked,
          onSearch: onSchemeSearch,
        },
      }
    : {
        component: 'Input',
        fieldName: 'schemeCode',
        label: '已确认方案编号',
        rules: 'required',
      };
}

async function open(
  record: ProjectDetail,
  operation: typeof mode.value,
  preset: { targetStatus?: ProjectStatus } = {},
) {
  project.value = record;
  mode.value = operation;
  key = '';
  fingerprint = '';
  failure.value = '';
  conflict.value = false;
  modalApi.setState({
    title: {
      'follow-up': '追加跟进与状态记录',
      scheme: record.schemeCode ? '重新关联方案' : '确认关联方案',
    }[operation],
  });
  modalApi.open();
  await nextTick();
  await formApi.reset();
  pickedScheme.value = undefined;
  if (operation === 'scheme') {
    formApi.setState({
      schema: [
        schemeField(),
        {
          component: 'Textarea',
          fieldName: 'confirmationNote',
          label: '客户确认依据',
          rules: 'required',
          componentProps: { maxlength: 2000, rows: 4 },
        },
      ],
    });
    if (hasAccessByCodes(['schemes.read'])) await searchSchemes('');
  } else {
    await loadRevisions(record);
    formApi.setState({ schema: followUpSchema(record) });
    const target =
      preset.targetStatus &&
      record.statusTransitions.includes(preset.targetStatus)
        ? preset.targetStatus
        : defaultTarget(record);
    await formApi.setValues({
      contactMethod: 'phone',
      contactedAt: new Date().toISOString(),
      ...(target ? { targetStatus: target } : {}),
      evidenceType:
        readyRevisions.value.length > 0 ? 'platform' : 'external_manual',
      quotationRevision: readyRevisions.value[0]?.revision,
      sentAt: new Date().toISOString(),
      channel: 'email',
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
      await loadRevisions(latest);
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
    <p
      v-if="mode === 'scheme' && project?.schemeCode"
      class="mb-4 text-sm text-muted-foreground"
    >
      当前已关联
      {{
        project.schemeCode
      }}；重新关联会替换方案与资料快照，原方案记录保留在时间线中。
    </p>
    <Form />
    <figure
      v-if="mode === 'scheme' && pickedScheme"
      class="mt-2 flex items-center gap-3"
      data-test="picked-scheme"
    >
      <img
        v-if="pickedScheme.thumbnailUrl"
        :src="pickedScheme.thumbnailUrl"
        :alt="pickedScheme.name"
        class="h-16 w-28 rounded object-cover"
      />
      <figcaption>
        <div class="font-medium">{{ pickedScheme.name }}</div>
        <div class="text-sm text-muted-foreground">
          {{ pickedScheme.code }} · {{ pickedScheme.size }}
        </div>
      </figcaption>
    </figure>
  </Modal>
</template>
