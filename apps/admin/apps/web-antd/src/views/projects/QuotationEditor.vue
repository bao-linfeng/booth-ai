<script setup lang="ts">
import type {
  ProjectDetail,
  Quotation,
  QuotationInput,
  QuotationItem,
} from '#/api/core/projects';

import { computed, nextTick, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { cloneDeep, downloadFileFromBlob, formatDateTime } from '@vben/utils';

import {
  Button,
  Card,
  Input,
  InputNumber,
  message,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  quotationApi,
  quotationDownloadApi,
  saveQuotationApi,
} from '#/api/core/projects';
const props = defineProps<{ project: ProjectDetail }>();
const emit = defineEmits<{ reload: [] }>();
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
let requestKey = '';
let fingerprint = '';
let initializing = false;
const terminal = computed(() =>
  ['closed', 'lost', 'won'].includes(props.project.status),
);
const [Form, formApi] = useVbenForm({
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2',
  handleValuesChange: () => {
    if (!initializing) dirty.value = true;
  },
  handleSubmit: async (values: Record<string, unknown>) => {
    if (
      !canEdit.value ||
      saving.value ||
      terminal.value ||
      viewingHistory.value
    )
      return;
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
    };
    const next = JSON.stringify(payload);
    if (next !== fingerprint) {
      requestKey = crypto.randomUUID();
      fingerprint = next;
    }
    payload.requestKey = requestKey;
    saving.value = true;
    try {
      const result = await saveQuotationApi(props.project.projectId, payload);
      displayed.value = result.quotation;
      baseRevision.value = result.quotation.revision;
      baseProjectRevision.value = result.projectRevision;
      dirty.value = false;
      message.success('报价修订已保存，项目状态未自动变更');
      emit('reload');
    } catch {
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
      component: 'Input',
      fieldName: 'validityTimeZone',
      label: '有效期时区',
      rules: 'required',
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
  [canEdit, terminal, viewingHistory, saving],
  () =>
    formApi.setState({
      commonConfig: {
        disabled:
          !canEdit.value ||
          terminal.value ||
          viewingHistory.value ||
          saving.value,
      },
    }),
  { immediate: true },
);
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
    if (!dirty.value && !viewingHistory.value)
      void initialize(props.project.quotation);
  },
  { immediate: true },
);
function copyBom() {
  if (terminal.value || viewingHistory.value) return;
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
async function loadHistory() {
  if (!history.value) return;
  if (dirty.value) {
    message.info('请先保存草稿，或明确放弃草稿后再切换历史。');
    return;
  }
  const result = await quotationApi(props.project.projectId, history.value);
  await initialize(result.quotation, true);
}
async function reset() {
  requestKey = '';
  fingerprint = '';
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
    title: '已存行金额',
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
      <InputNumber
        v-model:value="history"
        :min="1"
        :precision="0"
        placeholder="历史修订"
      />
      <Button @click="loadHistory">读取历史</Button>
      <Button @click="reset">放弃草稿 / 回到当前</Button>
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
      :disabled="!canEdit || saving || terminal || viewingHistory"
    >
      <Form />
      <div class="my-4 flex gap-3">
        <Button
          v-access:code="['projects.quotation']"
          :disabled="terminal || viewingHistory"
          @click="copyBom"
        >
          从项目清单快照复制材料
        </Button>
        <Button
          v-access:code="['projects.quotation']"
          :disabled="terminal || viewingHistory"
          @click="add"
        >
          新增服务 / 材料行
        </Button>
      </div>
      <Table
        :data-source="items"
        :columns="columns"
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
            :disabled="!canEdit || terminal || viewingHistory || saving"
            :options="[
              { value: 'material', label: '材料' },
              { value: 'graphic', label: '画面' },
              { value: 'transport', label: '运输' },
              { value: 'installation', label: '搭建' },
              { value: 'other', label: '其他' },
            ]"
            @change="dirty = true"
          />
          <span v-else-if="column.key === 'lineAmount'">{{
            record.lineAmount ?? '未保存 / 缺价'
          }}</span>
          <Button
            v-else-if="column.key === 'action'"
            v-access:code="['projects.quotation']"
            danger
            size="small"
            :disabled="!canEdit || terminal || viewingHistory || saving"
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
            :disabled="!canEdit || terminal || viewingHistory || saving"
            :maxlength="column.key === 'notes' ? 2000 : 500"
            @change="dirty = true"
          />
        </template>
      </Table>
    </fieldset>
    <div class="mt-5 space-y-3">
      <p>
        已存报价总额：<strong>{{
          displayed?.totalAmount === null || !displayed
            ? '待补完整价格'
            : `${displayed.currency} ${displayed.totalAmount}`
        }}</strong>
      </p>
      <p class="text-sm text-muted-foreground">
        单价留空表示待补，0 是有效零价；金额由服务端逐行 HALF_UP
        舍入。保存、导出不表示发送。数量/规格/单位改变或新增材料须填写差异原因。
      </p>
      <p v-if="displayed?.validationIssues.length" class="text-sm">
        待补项：{{ displayed.validationIssues.join('、') }}
      </p>
      <p v-if="terminal" class="text-sm">终态项目需先通过跟进记录明确重开。</p>
      <Button
        type="primary"
        :loading="saving"
        :disabled="terminal || viewingHistory"
        @click="formApi.validateAndSubmitForm()"
        v-access:code="['projects.quotation']"
      >
        保存新报价修订
      </Button>
    </div>
  </Card>
</template>
