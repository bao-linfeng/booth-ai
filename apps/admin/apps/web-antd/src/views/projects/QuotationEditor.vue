<script setup lang="ts">
import type {
  ProjectDetail,
  ProjectStatus,
  Quotation,
  QuotationInput,
  QuotationItem,
  QuotationRevisionSummary,
} from '#/api/core/projects';

import { computed, nextTick, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { cloneDeep, downloadFileFromBlob, formatDateTime } from '@vben/utils';

import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  quotationApi,
  quotationDownloadApi,
  quotationRevisionsApi,
  saveQuotationApi,
} from '#/api/core/projects';

import {
  failureReason,
  operationFailureMessage,
  terminalStatuses,
  validationIssueText,
} from './presentation';
import {
  currencyScales,
  isDecimal,
  isQuantity,
  lineAmount,
  quotationTotal,
} from './quotation-math';

const props = defineProps<{ project: ProjectDetail }>();
/** 报价随保存登记发送时带上 quoted，详情页据此提示更新客户说明 */
const emit = defineEmits<{ reload: [changedStatus?: ProjectStatus] }>();
const commonTimeZones = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];
/** 有效期时区：常用时区置顶，其余按 IANA 名称排序 */
function timeZoneOptions() {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    // 不支持枚举时只提供常用时区
  }
  return [
    ...commonTimeZones,
    ...all.filter((zone) => !commonTimeZones.includes(zone)),
  ].map((zone) => ({ value: zone, label: zone }));
}

const { hasAccessByCodes } = useAccess();
const canEdit = computed(() => hasAccessByCodes(['projects.quotation']));
const items = ref<QuotationItem[]>([]);
const displayed = ref<null | Quotation>(null);
const baseRevision = ref(0);
const baseProjectRevision = ref(0);
const saving = ref(false);
const dirty = ref(false);
const viewingHistory = ref(false);
const history = ref<number>();
/** 全部修订（倒序），用于历史修订下拉 */
const revisions = ref<QuotationRevisionSummary[]>([]);
const currency = ref('CNY');
/** 保存时遇到修订冲突：草稿保留，可载入最新修订号后再保存 */
const conflict = ref('');
let adoptLatest = false;
let requestKey = '';
let fingerprint = '';
let initializing = false;
const terminal = computed(() =>
  terminalStatuses.includes(props.project.status),
);
/** 保存并发送报价：需同时有报价与跟进权限 */
const canSend = computed(() =>
  hasAccessByCodes(['projects.quotation', 'projects.follow-up']),
);
/** 报价邮件发到客户联系邮箱 */
const recipient = computed(() => props.project.request.contact.email?.trim());
const sendDialog = ref(false);
let sendEmail = false;
const unassigned = computed(() => !props.project.assigneeAdminId);
/** 终态或待分配项目不能保存报价 */
const locked = computed(() => terminal.value || unassigned.value);
const [Form, formApi] = useVbenForm({
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2',
  handleValuesChange: (values) => {
    if (typeof values.currency === 'string') currency.value = values.currency;
    if (!initializing) dirty.value = true;
  },
  handleSubmit: async (values: Record<string, unknown>) => {
    if (!canEdit.value || saving.value || locked.value || viewingHistory.value)
      return;
    if (invalidRows.value.length > 0) {
      message.error(
        `第 ${invalidRows.value.join('、')} 行数量或单价格式不正确：数量需大于 0，最多 12 位整数、6 位小数；单价可留空表示待补。`,
      );
      return;
    }
    const payload: QuotationInput = {
      expectedRevision: baseProjectRevision.value,
      expectedQuotationRevision: baseRevision.value,
      requestKey: '',
      currency: String(values.currency),
      priceBasis: values.priceBasis as QuotationInput['priceBasis'],
      validUntil: String(values.validUntil),
      validityTimeZone: String(values.validityTimeZone),
      terms: String(values.terms ?? ''),
      inclusions: String(values.inclusions ?? ''),
      exclusions: String(values.exclusions ?? ''),
      changeReason: String(values.changeReason ?? ''),
      items: items.value.map(({ lineAmount: _amount, ...item }) => ({
        ...item,
        unitPrice: item.unitPrice === '' ? null : item.unitPrice,
      })),
      ...(sendEmail ? { sendEmail } : {}),
    };
    const next = JSON.stringify(payload);
    if (next !== fingerprint) {
      requestKey = crypto.randomUUID();
      fingerprint = next;
    }
    payload.requestKey = requestKey;
    saving.value = true;
    conflict.value = '';
    try {
      const result = await saveQuotationApi(props.project.projectId, payload);
      displayed.value = result.quotation;
      baseRevision.value = result.quotation.revision;
      baseProjectRevision.value = result.projectRevision;
      dirty.value = false;
      message.success(
        payload.sendEmail
          ? '报价修订已保存，报价邮件已进入发送队列，项目已转为已报价'
          : '报价修订已保存，项目状态未自动变更',
      );
      emit('reload', payload.sendEmail ? 'quoted' : undefined);
      void loadRevisions();
    } catch (error) {
      const reason = failureReason(error);
      if (
        reason === 'PROJECT_REVISION_CHANGED' ||
        reason === 'QUOTATION_REVISION_CHANGED'
      )
        conflict.value = operationFailureMessage(error);
      // 其他业务原因由请求拦截器统一提示；没有原因时结果未确认
      else if (!reason)
        message.error(
          '报价保存未确认，草稿已保留。请先检查项目最新修订再比较，避免覆盖其他人的修改。',
        );
    } finally {
      saving.value = false;
    }
  },
  schema: [
    {
      component: 'Select',
      fieldName: 'currency',
      label: '报价币种',
      rules: 'required',
      componentProps: {
        options: ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'KRW', 'KWD'].map(
          (value) => ({ value, label: value }),
        ),
      },
    },
    {
      component: 'Select',
      fieldName: 'priceBasis',
      label: '税费口径',
      rules: 'required',
      componentProps: {
        options: [
          { value: 'included', label: '含税' },
          { value: 'excluded', label: '不含税' },
          { value: 'not_applicable', label: '不适用' },
        ],
      },
    },
    {
      component: 'DatePicker',
      fieldName: 'validUntil',
      label: '有效期',
      rules: 'required',
      componentProps: { valueFormat: 'YYYY-MM-DD' },
    },
    {
      component: 'Select',
      fieldName: 'validityTimeZone',
      label: '有效期时区',
      rules: 'selectRequired',
      componentProps: {
        options: timeZoneOptions(),
        optionFilterProp: 'label',
        showSearch: true,
      },
    },
    {
      component: 'Textarea',
      fieldName: 'inclusions',
      label: '包含范围',
      componentProps: { rows: 2, maxlength: 5000 },
    },
    {
      component: 'Textarea',
      fieldName: 'exclusions',
      label: '不包含范围',
      componentProps: { rows: 2, maxlength: 5000 },
    },
    {
      component: 'Textarea',
      fieldName: 'terms',
      label: '客户可见条款 / 税费说明',
      componentProps: { rows: 2, maxlength: 5000 },
    },
    {
      component: 'Textarea',
      fieldName: 'changeReason',
      label: '本次修订原因（内部）',
      rules: 'required',
      componentProps: { rows: 2, maxlength: 2000 },
    },
  ],
});
watch(
  [canEdit, locked, viewingHistory, saving],
  () =>
    formApi.setState({
      commonConfig: {
        disabled:
          !canEdit.value ||
          locked.value ||
          viewingHistory.value ||
          saving.value,
      },
    }),
  { immediate: true },
);
const scale = computed(() => currencyScales[currency.value] ?? 2);
/** 编辑中的行金额（与服务端相同的 HALF_UP 算法），保存后以服务端结果为准 */
const liveAmounts = computed(() =>
  items.value.map((item) =>
    lineAmount(item.quantity, item.unitPrice, scale.value),
  ),
);
const liveTotal = computed(() =>
  quotationTotal(liveAmounts.value, scale.value),
);
const blankPrice = (item: QuotationItem) =>
  item.unitPrice === null || item.unitPrice === '';
const quantityInvalid = (item: QuotationItem) => !isQuantity(item.quantity);
const priceInvalid = (item: QuotationItem) =>
  !blankPrice(item) && !isDecimal(item.unitPrice);
/** 数量或单价格式不合法的行号（从 1 开始） */
const invalidRows = computed(() =>
  items.value.flatMap((item, index) =>
    quantityInvalid(item) || priceInvalid(item) ? [index + 1] : [],
  ),
);
const issueTexts = computed(() =>
  (displayed.value?.validationIssues ?? []).map((issue) =>
    validationIssueText(issue, displayed.value?.items ?? []),
  ),
);
function rowClass(record: QuotationItem) {
  return blankPrice(record) ? 'quotation-row-missing' : '';
}
const revisionOptions = computed(() =>
  revisions.value.map((revision) => ({
    value: revision.revision,
    label: `r${revision.revision} · ${revision.completeness === 'ready' ? '完整' : '待补'} · ${
      revision.totalAmount === null
        ? '待补价格'
        : `${revision.currency} ${revision.totalAmount}`
    } · ${revision.createdByName ?? '—'} ${formatDateTime(revision.createdAt)}`,
  })),
);
async function loadRevisions() {
  if (!props.project.quotation) {
    revisions.value = [];
    return;
  }
  try {
    revisions.value = await quotationRevisionsApi(props.project.projectId);
  } catch {
    revisions.value = [];
  }
}
/** 修订冲突后载入最新：刷新项目并改用最新修订号，草稿保留 */
function loadLatest() {
  adoptLatest = true;
  emit('reload');
}
/** 发送前先在前端拦下不完整的草稿：至少一行且每行都已填价 */
function openSendDialog() {
  const unpriced = items.value.flatMap((item, index) =>
    blankPrice(item) ? [index + 1] : [],
  );
  if (items.value.length === 0) {
    message.error('还没有报价行，补全后才能发送');
    return;
  }
  if (unpriced.length > 0) {
    message.error(`第 ${unpriced.join('、')} 行未填单价，补全价格后才能发送`);
    return;
  }
  sendDialog.value = true;
}
/** 在同一次保存中放入邮件发送队列：修订不完整或已过有效期时整体失败，修订不保存 */
async function confirmSend() {
  sendDialog.value = false;
  sendEmail = true;
  try {
    await formApi.validateAndSubmitForm();
  } finally {
    sendEmail = false;
  }
}
async function initialize(quotation: null | Quotation, historyMode = false) {
  initializing = true;
  displayed.value = quotation;
  viewingHistory.value = historyMode;
  baseRevision.value = props.project.quotation?.revision ?? 0;
  baseProjectRevision.value = props.project.revision;
  items.value = quotation ? cloneDeep(quotation.items) : [];
  await formApi.reset();
  await formApi.setValues(
    quotation ?? {
      currency: props.project.request.materialBudget?.currency ?? 'CNY',
      priceBasis: 'excluded',
      validUntil: new Date(Date.now() + 30 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      validityTimeZone: 'Asia/Shanghai',
      terms: '',
      inclusions: '',
      exclusions: '',
      changeReason: '',
    },
  );
  await nextTick();
  dirty.value = false;
  initializing = false;
}
watch(
  () => props.project,
  () => {
    void loadRevisions();
    if (adoptLatest) {
      adoptLatest = false;
      conflict.value = '';
      baseRevision.value = props.project.quotation?.revision ?? 0;
      baseProjectRevision.value = props.project.revision;
      message.info(
        '已载入最新修订号，草稿已保留；可在历史修订中核对他人的修改后再保存。',
      );
      return;
    }
    if (!dirty.value && !viewingHistory.value)
      void initialize(props.project.quotation);
  },
  { immediate: true },
);
function copyBom() {
  if (locked.value || viewingHistory.value) return;
  items.value = (props.project.materials.bom?.items ?? []).map((item) => ({
    clientLineId: crypto.randomUUID(),
    kind: 'material',
    bomItemId: item.id,
    name: item.productName,
    model: item.productModel ?? '',
    specificationMm: item.specificationMm ?? '',
    quantity: item.quantity,
    pricingUnit: item.pricingUnit,
    unitPrice: null,
    erpCode: item.erpCode ?? '',
  }));
  dirty.value = true;
}
function add() {
  items.value.push({
    clientLineId: crypto.randomUUID(),
    kind: 'other',
    name: '',
    quantity: '1',
    pricingUnit: '项',
    unitPrice: null,
  });
  dirty.value = true;
}
async function loadHistory(revision: unknown) {
  if (typeof revision !== 'number') return;
  if (dirty.value) {
    history.value = undefined;
    message.info('请先保存草稿，或点「放弃草稿」后再查看历史修订。');
    return;
  }
  history.value = revision;
  const result = await quotationApi(props.project.projectId, revision);
  await initialize(result.quotation, true);
}
/** 放弃草稿：丢弃未保存的修改，回到当前修订 */
async function discardDraft() {
  requestKey = '';
  fingerprint = '';
  conflict.value = '';
  await initialize(props.project.quotation);
}
/** 回到当前：退出历史查看 */
async function backToCurrent() {
  history.value = undefined;
  await initialize(props.project.quotation);
}
async function download() {
  if (!displayed.value) return;
  const blob = await quotationDownloadApi(
    props.project.projectId,
    displayed.value.revision,
  );
  downloadFileFromBlob({
    source: blob,
    fileName: `${props.project.projectNo}-报价-r${displayed.value.revision}.xlsx`,
  });
}
const columns = [
  { title: '类别', dataIndex: 'kind', key: 'kind', width: 140 },
  { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
  { title: '型号', dataIndex: 'model', key: 'model', width: 140 },
  {
    title: '规格/mm',
    dataIndex: 'specificationMm',
    key: 'specificationMm',
    width: 160,
  },
  { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 120 },
  {
    title: '计价单位',
    dataIndex: 'pricingUnit',
    key: 'pricingUnit',
    width: 100,
  },
  { title: '单价', dataIndex: 'unitPrice', key: 'unitPrice', width: 140 },
  {
    title: '行金额',
    dataIndex: 'lineAmount',
    key: 'lineAmount',
    width: 140,
  },
  { title: 'ERP编码', dataIndex: 'erpCode', key: 'erpCode', width: 130 },
  {
    title: '差异原因',
    dataIndex: 'differenceReason',
    key: 'differenceReason',
    width: 200,
  },
  { title: '客户备注', dataIndex: 'notes', key: 'notes', width: 200 },
  { title: '操作', key: 'action', width: 80 },
];
</script>
<template>
  <Card title="人工报价 / 不可变修订">
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <Tag>{{ viewingHistory ? '历史报价' : '当前编辑' }}</Tag>
      <span v-if="displayed">
        {{ displayed.quotationNo }} · 修订 {{ displayed.revision }} ·
        {{ formatDateTime(displayed.createdAt) }}
      </span>
      <Select
        :value="history"
        class="w-[420px] max-w-full"
        data-test="history"
        placeholder="查看历史修订"
        :options="revisionOptions"
        :disabled="revisions.length === 0"
        @change="loadHistory"
      />
      <Button v-if="viewingHistory" @click="backToCurrent">回到当前</Button>
      <Button v-else-if="dirty" @click="discardDraft">放弃草稿</Button>
      <Button
        v-access:code="['projects.quotation-download']"
        :disabled="!displayed || displayed.completeness !== 'ready'"
        @click="download"
      >
        导出已存修订 {{ displayed?.revision }}
      </Button>
    </div>
    <fieldset
      class="min-w-0"
      :disabled="!canEdit || saving || locked || viewingHistory"
    >
      <Form />
      <div class="my-4 flex gap-3">
        <Button
          v-access:code="['projects.quotation']"
          :disabled="locked || viewingHistory"
          @click="copyBom"
        >
          从项目清单快照复制材料
        </Button>
        <Button
          v-access:code="['projects.quotation']"
          :disabled="locked || viewingHistory"
          @click="add"
        >
          新增服务 / 材料行
        </Button>
      </div>
      <Table
        :data-source="items"
        :columns="columns"
        :row-class-name="rowClass"
        row-key="clientLineId"
        :scroll="{ x: 1800 }"
        :pagination="{ pageSize: 20 }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <Select
            v-if="column.key === 'kind'"
            v-model:value="record.kind"
            class="w-full"
            :disabled="!canEdit || locked || viewingHistory || saving"
            :options="[
              { value: 'material', label: '材料' },
              { value: 'graphic', label: '画面' },
              { value: 'transport', label: '运输' },
              { value: 'installation', label: '搭建' },
              { value: 'other', label: '其他' },
            ]"
            @change="dirty = true"
          />
          <span
            v-else-if="column.key === 'lineAmount'"
            data-test="line-amount"
            >{{
              liveAmounts[items.indexOf(record as QuotationItem)] ??
              (blankPrice(record as QuotationItem) ? '缺价' : '格式不正确')
            }}</span>
          <Input
            v-else-if="column.key === 'quantity' || column.key === 'unitPrice'"
            v-model:value="record[column.key]"
            :status="
              (
                column.key === 'quantity'
                  ? quantityInvalid(record as QuotationItem)
                  : priceInvalid(record as QuotationItem)
              )
                ? 'error'
                : undefined
            "
            :placeholder="
              column.key === 'unitPrice' ? '留空表示待补' : undefined
            "
            :disabled="!canEdit || locked || viewingHistory || saving"
            :maxlength="20"
            @change="dirty = true"
          />
          <Button
            v-else-if="column.key === 'action'"
            v-access:code="['projects.quotation']"
            danger
            size="small"
            :disabled="!canEdit || locked || viewingHistory || saving"
            @click="
              items = items.filter(
                (item) => item.clientLineId !== record.clientLineId,
              );
              dirty = true;
            "
          >
            删除
          </Button>
          <Input
            v-else-if="column.key !== undefined"
            v-model:value="record[column.key]"
            :disabled="!canEdit || locked || viewingHistory || saving"
            :maxlength="column.key === 'notes' ? 2000 : 500"
            @change="dirty = true"
          />
        </template>
      </Table>
    </fieldset>
    <div class="mt-5 space-y-3">
      <Alert v-if="conflict" type="warning" show-icon :message="conflict">
        <template #action>
          <Button size="small" @click="loadLatest">载入最新</Button>
        </template>
      </Alert>
      <p>
        当前合计：<strong data-test="live-total">{{
          liveTotal === null ? '待补完整价格' : `${currency} ${liveTotal}`
        }}</strong>
        <span class="ml-4 text-sm text-muted-foreground">
          已存报价总额：{{
            displayed?.totalAmount === null || !displayed
              ? '待补完整价格'
              : `${displayed.currency} ${displayed.totalAmount}`
          }}
        </span>
      </p>
      <p class="text-sm text-muted-foreground">
        单价留空表示待补，0 是有效零价；行金额按币种小数位逐行 HALF_UP
        舍入，编辑时实时计算，保存后以服务端结果为准。保存、导出不表示发送。数量/规格/单位改变或新增材料须填写差异原因。
      </p>
      <p v-if="issueTexts.length" class="text-sm" data-test="issues">
        已存修订待补项：{{ issueTexts.join('、') }}
      </p>
      <p v-if="terminal" class="text-sm">终态项目需先通过跟进记录明确重开。</p>
      <p v-else-if="unassigned" class="text-sm">待分配项目需先分配承接人。</p>
      <Button
        type="primary"
        :loading="saving"
        :disabled="locked || viewingHistory"
        @click="formApi.validateAndSubmitForm()"
        v-access:code="['projects.quotation']"
      >
        保存新报价修订
      </Button>
      <Tooltip
        v-if="canSend"
        :title="recipient ? undefined : '客户未留联系邮箱，无法发送报价邮件'"
      >
        <Button
          class="ml-2"
          :loading="saving"
          :disabled="locked || viewingHistory || !recipient"
          @click="openSendDialog"
        >
          保存并发送报价
        </Button>
      </Tooltip>
    </div>
    <Modal
      v-model:open="sendDialog"
      title="保存并发送报价"
      ok-text="保存并发送"
      @ok="confirmSend"
    >
      <p class="text-sm">
        保存新修订后，系统会把报价单（Excel 附件）通过邮件发送到客户联系邮箱
        <strong data-test="send-recipient">{{ recipient }}</strong>，项目转为「已报价」。
      </p>
      <p class="mt-2 text-sm text-muted-foreground">
        邮件进入发送队列，送达或失败都会记录在时间线中；修订已过有效期时整体不保存。
      </p>
    </Modal>
  </Card>
</template>
<style scoped>
:deep(.quotation-row-missing) > td {
  background: hsl(var(--warning) / 10%);
}
</style>
