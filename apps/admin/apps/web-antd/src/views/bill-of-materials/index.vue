<script setup lang="ts">
import type { BomImportResult, BomItem, BomRecord } from '#/api/core/bom';
import type { DictionaryItemRecord } from '#/api/core/dictionaries';

import { computed, reactive, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { downloadFileFromBlob, formatDate } from '@vben/utils';

import {
  Button as AButton,
  Descriptions as ADescriptions,
  Empty as AEmpty,
  Form as AForm,
  Input as AInput,
  Modal as AModal,
  Radio as ARadio,
  Select as ASelect,
  Table as ATable,
  Tag as ATag,
  message,
} from 'ant-design-vue';

import {
  commitBomImportApi,
  deleteBomItemApi,
  downloadBomApi,
  getBomApi,
  submitBomVerificationApi,
  updateBomItemsApi,
  uploadBomImportApi,
} from '#/api/core/bom';
import {
  getDictionaryItemsApi,
  getDictionaryListApi,
} from '#/api/core/dictionaries';

const emit = defineEmits<{ reload: [] }>();
const AFormItem = AForm.Item;
const ADescriptionsItem = ADescriptions.Item;
const ARadioGroup = ARadio.Group;
const ASelectOption = ASelect.Option;
const ATextarea = AInput.TextArea;

const currentCode = ref('');
const mode = ref<'detail' | 'edit'>('detail');
const [Modal, modalApi] = useVbenModal({
  onOpenChange(isOpen) {
    if (!isOpen) {
      bomRequestSequence++;
      editingItems.value = false;
      productDetailVisible.value = false;
      verifyModalVisible.value = false;
    }
  },
});

// BOM 清单工作区状态
const bomLoading = ref(false);
const bomData = ref<BomRecord | null>(null);
const bomImportResult = ref<BomImportResult | null>(null);
const bomImporting = ref(false);
const bomCommitting = ref(false);
const bomSaving = ref(false);
const bomEditRevision = ref<null | number>(null);
const editingItems = ref(false);
const itemDraft = ref<BomItem | null>(null);
const bomChangeReason = ref('');
const measurementKinds = ref<DictionaryItemRecord[]>([]);
const verifyRequestKey = ref('');
let verificationAttempt: null | {
  code: string;
  payload: Parameters<typeof submitBomVerificationApi>[1];
} = null;
let bomRequestSequence = 0;
const hasBom = computed(
  () => !!bomData.value && bomData.value.status !== 'absent',
);
const bomLocked = computed(() => bomData.value?.status === 'verified');
const selectedProduct = ref<BomItem | null>(null);
const productDetailVisible = ref(false);
const selectedPricingUnit = computed(() =>
  selectedProduct.value?.measurementKind === 'length'
    ? 'm'
    : selectedProduct.value?.measurementKind === 'area'
      ? 'm²'
      : (selectedProduct.value?.sourceUnit ?? '—'),
);
const measurementKindLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(
    measurementKinds.value.map((item) => [item.itemValue, item.itemLabel]),
  ),
);

async function fetchMeasurementKinds(sequence: number) {
  const result = await getDictionaryListApi({
    code: 'measurementKind',
    enabled: true,
    page: 1,
    pageSize: 100,
  });
  const dictionary = result.data.find(
    (entry) => entry.code === 'measurementKind',
  );
  const items = dictionary
    ? (await getDictionaryItemsApi(dictionary.id)).filter(
        (item) => item.enabled,
      )
    : [];
  if (sequence === bomRequestSequence) measurementKinds.value = items;
}

// 核验弹窗
const verifyModalVisible = ref(false);
const verifySubmitting = ref(false);
const verifyForm = reactive({
  decision: 'pass' as 'pass' | 'reject',
  notes: '',
});

async function fetchBom() {
  if (!currentCode.value) return;
  const requestCode = currentCode.value;
  const sequence = ++bomRequestSequence;
  bomLoading.value = true;
  try {
    const data = await getBomApi(requestCode);
    if (sequence === bomRequestSequence && requestCode === currentCode.value)
      bomData.value = data;
  } catch (error: any) {
    if (sequence !== bomRequestSequence) return;
    if (error?.status === 404 || error?.response?.status === 404) {
      bomData.value = null;
    } else {
      message.error(error?.message || '加载清单失败');
    }
  } finally {
    if (sequence === bomRequestSequence) bomLoading.value = false;
  }
}

async function handleBomImport() {
  if (bomLocked.value || bomLoading.value) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xlsm';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file || bomLocked.value) return;
    bomImporting.value = true;
    const requestCode = currentCode.value;
    try {
      const currentRevision = bomData.value?.revision ?? 0;
      const result = await uploadBomImportApi(
        requestCode,
        file,
        currentRevision,
      );
      if (requestCode !== currentCode.value) return;
      bomImportResult.value = result;
      message.success('文件解析完成，请确认后提交');
    } catch (error: any) {
      message.error(error?.message || '上传失败');
    } finally {
      bomImporting.value = false;
    }
  });
  input.click();
}

async function handleBomCommit() {
  if (
    !bomImportResult.value ||
    bomCommitting.value ||
    bomLoading.value ||
    bomLocked.value
  )
    return;
  const requestCode = currentCode.value;
  bomCommitting.value = true;
  try {
    const result = await commitBomImportApi(
      requestCode,
      bomImportResult.value.importId,
      {
        expectedRevision: bomImportResult.value.baseRevision,
      },
    );
    if (currentCode.value !== requestCode) return;
    message.success(`导入成功，清单已更新至修订版本 ${result.revision}`);
    if (result.unpublished) message.warning('方案已自动下架，请重新审核后发布');
    bomImportResult.value = null;
    productDetailVisible.value = false;
    selectedProduct.value = null;
    await fetchBom();
    emit('reload');
  } catch (error: any) {
    if (error?.response?.status === 409)
      message.warning('清单修订或导入请求已变化，请核对后重新导入');
  } finally {
    bomCommitting.value = false;
  }
}

function openVerifyModal() {
  if (!hasBom.value || bomLoading.value || bomLocked.value) return;
  verifyRequestKey.value = crypto.randomUUID();
  verificationAttempt = null;
  verifyForm.decision = 'pass';
  verifyForm.notes = '';
  verifyModalVisible.value = true;
}

async function handleVerifySubmit() {
  if (!bomData.value || !hasBom.value || bomLocked.value) return;
  if (verifyForm.decision === 'reject' && !verifyForm.notes.trim()) {
    message.warning('不通过时请填写核验意见');
    return;
  }
  verifySubmitting.value = true;
  try {
    const payload = {
      requestKey: verifyRequestKey.value,
      expectedRevision: bomData.value.revision,
      decision: verifyForm.decision,
      ...(verifyForm.decision === 'reject'
        ? { notes: verifyForm.notes.trim() }
        : {}),
    };
    const requestCode = currentCode.value;
    if (verificationAttempt?.code === requestCode) {
      if (
        JSON.stringify(verificationAttempt.payload) !== JSON.stringify(payload)
      ) {
        message.warning('上次核验结果未确定，请保持表单内容不变后重试');
        return;
      }
    } else verificationAttempt = { code: requestCode, payload };
    const result = await submitBomVerificationApi(
      requestCode,
      verificationAttempt.payload,
    );
    if (currentCode.value !== requestCode) return;
    message.success(
      result.status === 'verified' ? '核验通过' : '核验不通过已记录',
    );
    verifyModalVisible.value = false;
    verificationAttempt = null;
    await fetchBom();
    emit('reload');
  } catch (error: any) {
    message.error(error?.message || '提交核验失败');
  } finally {
    verifySubmitting.value = false;
  }
}

function startItemEdit(id: string) {
  if (!hasBom.value || !bomData.value || bomLocked.value) return;
  const item = bomData.value.items.find((entry) => entry.id === id);
  if (!item) return;
  itemDraft.value = { ...item };
  bomEditRevision.value = bomData.value.revision;
  editingItems.value = true;
  bomChangeReason.value = '';
}
function selectMeasurementKind(value: unknown) {
  if (!itemDraft.value || typeof value !== 'string') return;
  if (value !== 'count' && value !== 'length' && value !== 'area') return;
  if (itemDraft.value.measurementKind === value) return;
  itemDraft.value.measurementKind = value;
  itemDraft.value.sourceUnit =
    value === 'count' ? '件' : value === 'length' ? 'mm' : 'mm²';
}
function openProductDetail(id: string) {
  const item = bomData.value?.items.find((entry) => entry.id === id);
  if (!item) return;
  selectedProduct.value = item;
  productDetailVisible.value = true;
}
function handleItemDelete(id: string) {
  const bom = bomData.value;
  const item = bom?.items.find((entry) => entry.id === id);
  if (!bom || !item || bomLoading.value || bomLocked.value) return;
  if (bom.items.length === 1) {
    message.warning('最后一条不能单独删除，请在清单列表删除整份清单');
    return;
  }
  const requestCode = currentCode.value;
  const requestSequence = bomRequestSequence;
  AModal.confirm({
    title: '确认删除条目',
    content: `确定删除「${item.productName}」吗？清单需要重新核验。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        const updated = await deleteBomItemApi(requestCode, id, bom.revision);
        emit('reload');
        message.success('条目已删除，清单需重新核验');
        if (
          bomRequestSequence !== requestSequence ||
          bomData.value?.id !== bom.id ||
          currentCode.value !== requestCode
        )
          return;
        bomRequestSequence++;
        bomData.value = updated;
        productDetailVisible.value = false;
        selectedProduct.value = null;
      } catch (error: any) {
        if (
          error?.response?.status === 409 &&
          currentCode.value === requestCode
        ) {
          message.warning('清单已变化，请刷新后重试');
          await fetchBom();
          emit('reload');
        }
      }
    },
  });
}
async function saveBomDraft() {
  if (bomSaving.value || bomLocked.value) return;
  if (
    !bomData.value ||
    bomEditRevision.value === null ||
    !bomChangeReason.value.trim()
  ) {
    message.warning('请填写变更原因');
    return;
  }
  bomSaving.value = true;
  try {
    const draft = itemDraft.value;
    if (
      !draft?.productName.trim() ||
      !draft.sourceQuantity.trim() ||
      !measurementKinds.value.some(
        (kind) => kind.itemValue === draft.measurementKind,
      )
    ) {
      message.warning('请填写产品名称、数量和计量类型');
      return;
    }
    await updateBomItemsApi(currentCode.value, {
      expectedRevision: bomEditRevision.value,
      changeReason: bomChangeReason.value.trim(),
      items: bomData.value.items.map((original) => {
        const item = original.id === draft.id ? draft : original;
        return {
          id: item.id,
          productName: item.productName,
          productModel: item.productModel,
          specificationMm: item.specificationMm,
          sourceQuantity: item.sourceQuantity,
          sourceUnit: item.sourceUnit,
          measurementKind: item.measurementKind,
          erpCode: item.erpCode,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          totalWeightKg: item.totalWeightKg,
          diffNote: item.diffNote,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        };
      }),
    });
    editingItems.value = false;
    bomEditRevision.value = null;
    itemDraft.value = null;
    productDetailVisible.value = false;
    selectedProduct.value = null;
    await fetchBom();
    emit('reload');
    message.success('清单已保存，需重新核验');
  } catch (error: any) {
    if (error?.response?.status === 409)
      message.warning('清单已变化，请保留当前编辑并核对最新版本');
  } finally {
    bomSaving.value = false;
  }
}
async function handleBomDownload() {
  if (!bomData.value || bomData.value.status !== 'verified') return;
  try {
    const blob = await downloadBomApi(
      currentCode.value,
      bomData.value.revision,
    );
    downloadFileFromBlob({
      source: blob,
      fileName: `${currentCode.value.replaceAll(/[\\/:*?"<>|]/g, '_')}@简化清单.xlsx`,
    });
  } catch {
    /* handled by request interceptor */
  }
}

function open(code: string, action: 'detail' | 'edit') {
  bomRequestSequence++;
  currentCode.value = code;
  mode.value = action;
  bomData.value = null;
  bomImportResult.value = null;
  productDetailVisible.value = false;
  selectedProduct.value = null;
  verifyModalVisible.value = false;
  verifyRequestKey.value = '';
  verificationAttempt = null;
  editingItems.value = false;
  bomEditRevision.value = null;
  itemDraft.value = null;
  measurementKinds.value = [];
  modalApi.open();
  void fetchBom();
  const sequence = bomRequestSequence;
  void fetchMeasurementKinds(sequence).catch(() => {
    if (sequence === bomRequestSequence) message.error('加载计量类型字典失败');
  });
}
defineExpose({ open });
</script>

<template>
  <Modal
    :title="`${mode === 'detail' ? '清单详情' : '编辑清单'} · ${currentCode}`"
    class="w-[min(1400px,96vw)]"
    :footer="false"
  >
    <div v-loading="bomLoading" class="max-h-[75vh] space-y-4 overflow-y-auto">
      <!-- 状态栏 -->
      <div
        class="border-border bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">清单状态</span>
          <ATag v-if="!hasBom" color="default">无清单</ATag>
          <ATag
            v-else-if="bomData && bomData.status === 'verified'"
            color="success"
          >
            已核验
          </ATag>
          <ATag
            v-else-if="bomData && bomData.status === 'rejected'"
            color="error"
          >
            核验不通过
          </ATag>
          <ATag v-else color="warning">待核验</ATag>
          <span v-if="hasBom" class="text-muted-foreground text-xs">
            修订版本 {{ bomData?.revision }}
          </span>
          <span
            v-if="bomData?.verifiedAt"
            class="text-muted-foreground text-xs"
          >
            · 核验于 {{ formatDate(bomData.verifiedAt) }}
          </span>
        </div>
        <div v-if="mode === 'edit'" class="flex flex-wrap gap-2">
          <AButton
            v-if="bomData && bomData.status === 'verified'"
            size="small"
            :disabled="bomLoading"
            @click="handleBomDownload"
          >
            导出客户清单
          </AButton>
          <AButton
            v-if="hasBom"
            :disabled="bomLoading || bomLocked"
            size="small"
            type="primary"
            ghost
            @click="openVerifyModal"
          >
            提交核验
          </AButton>
          <AButton
            size="small"
            :disabled="bomLoading || bomLocked"
            :loading="bomImporting"
            @click="handleBomImport"
          >
            导入 XLSX/XLSM
          </AButton>
        </div>
      </div>
      <p v-if="mode === 'edit'" class="text-muted-foreground text-xs">
        导入表首行须包含：产品名称、型号、规格/mm、数量、计量类型、单价/¥、总价/¥、重量合计/kg、ERP编码，列顺序不限。每行填写计量类型
        count / length / area，数量分别按件、mm、mm² 解析。
      </p>

      <!-- 导入预览区 -->
      <div
        v-if="mode === 'edit' && bomImportResult"
        class="border-border bg-muted/50 space-y-3 rounded-lg border p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-medium">导入预览</span>
          <AButton size="small" @click="bomImportResult = null"> 取消 </AButton>
        </div>
        <div class="text-muted-foreground space-y-1 text-sm">
          <div>文件：{{ bomImportResult.sourceFileName }}</div>
          <div>关联方案：{{ currentCode }}（由当前页面明确指定）</div>
          <div>基础修订：{{ bomImportResult.baseRevision }}</div>
          <div>可提交：{{ bomImportResult.canCommit ? '是' : '否' }}</div>
        </div>
        <!-- 错误列表 -->
        <div v-if="bomImportResult.errors.length > 0" class="space-y-1">
          <div class="text-destructive text-sm font-medium">
            错误（{{ bomImportResult.errors.length }} 条）
          </div>
          <div
            v-for="(err, i) in bomImportResult.errors"
            :key="i"
            class="text-destructive bg-destructive/10 rounded px-2 py-1 text-xs"
          >
            [{{ err.code }}] {{ err.message }}
            <span v-if="err.sheet"> · {{ err.sheet }}</span>
            <span v-if="err.row"> 行{{ err.row }}</span>
          </div>
        </div>
        <!-- 警告列表 -->
        <div v-if="bomImportResult.warnings.length > 0" class="space-y-1">
          <div class="text-sm font-medium text-amber-700 dark:text-amber-400">
            警告（{{ bomImportResult.warnings.length }} 条）
          </div>
          <div
            v-for="(warn, i) in bomImportResult.warnings"
            :key="i"
            class="bg-warning/10 rounded px-2 py-1 text-xs text-amber-700 dark:text-amber-400"
          >
            [{{ warn.code }}] {{ warn.message }}
          </div>
        </div>
        <!-- 预览条目 -->
        <div v-if="bomImportResult.items.length > 0">
          <div class="text-sm font-medium mb-2">
            预览条目（{{ bomImportResult.items.length }} 行）
          </div>
          <ATable
            :data-source="bomImportResult.items"
            :columns="[
              { title: '序', dataIndex: 'ordinal', width: 50 },
              { title: '产品名称', dataIndex: 'productName' },
              { title: '型号', dataIndex: 'productModel' },
              { title: '规格(mm)', dataIndex: 'specificationMm' },
              { title: '数量', dataIndex: 'sourceQuantity' },
              {
                title: '计量类型',
                dataIndex: 'measurementKind',
                customRender: ({ text }: { text: string }) =>
                  measurementKindLabels[text] ?? text,
              },
              { title: '单价/¥', dataIndex: 'unitPrice' },
              { title: '总价/¥', dataIndex: 'totalPrice' },
              { title: '重量合计/kg', dataIndex: 'totalWeightKg' },
              { title: 'ERP', dataIndex: 'erpCode' },
            ]"
            :pagination="false"
            size="small"
            row-key="ordinal"
          />
        </div>
        <div class="flex justify-end">
          <AButton
            type="primary"
            :disabled="!bomImportResult.canCommit || bomLoading || bomLocked"
            :loading="bomCommitting"
            @click="handleBomCommit"
          >
            {{ bomImportResult.canCommit ? '确认导入' : '存在错误，无法导入' }}
          </AButton>
        </div>
      </div>

      <!-- 当前清单条目 -->
      <div v-if="hasBom && bomData && bomData.items.length > 0">
        <div class="mb-2 text-sm font-medium">
          当前清单（{{ bomData.items.length }} 行）
        </div>
        <ATable
          :data-source="bomData.items"
          :columns="[
            { title: '序号', dataIndex: 'ordinal', width: 60 },
            {
              title: '产品名称',
              dataIndex: 'productName',
              ellipsis: true,
            },
            {
              title: '产品型号',
              dataIndex: 'productModel',
              ellipsis: true,
            },
            {
              title: '尺寸规格(mm)',
              dataIndex: 'specificationMm',
              ellipsis: true,
            },
            { title: '数量', dataIndex: 'quantity', width: 80 },
            { title: '原数量', dataIndex: 'sourceQuantity', width: 80 },
            {
              title: '计量类型',
              dataIndex: 'measurementKind',
              customRender: ({ text }: { text: string }) =>
                measurementKindLabels[text] ?? text,
            },
            { title: '单价/¥', dataIndex: 'unitPrice', width: 100 },
            { title: '总价/¥', dataIndex: 'totalPrice', width: 100 },
            { title: '重量合计/kg', dataIndex: 'totalWeightKg', width: 120 },
            { title: 'ERP编码', dataIndex: 'erpCode', width: 120 },
            {
              title: '操作',
              key: 'action',
              width: mode === 'edit' ? 180 : 70,
              fixed: 'right',
            },
          ]"
          :pagination="{ pageSize: 20, showSizeChanger: false }"
          size="small"
          row-key="id"
          :scroll="{ x: 1400 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'action'">
              <AButton
                type="link"
                size="small"
                @click="openProductDetail(record.id)"
                >
详情
</AButton>
              <AButton
                v-if="mode === 'edit'"
                type="link"
                size="small"
                :disabled="bomLocked"
                @click="startItemEdit(record.id)"
                >
编辑
</AButton>
              <AButton
                v-if="mode === 'edit'"
                type="link"
                size="small"
                danger
                :disabled="bomLocked"
                @click="handleItemDelete(record.id)"
                >
删除
</AButton>
            </template>
          </template>
        </ATable>
      </div>

      <!-- 空状态 -->
      <AEmpty
        v-if="!hasBom || bomData?.items.length === 0"
        description="暂无清单数据，请上传 XLSX/XLSM 文件导入"
      />
    </div>
  </Modal>

  <AModal
    v-model:open="editingItems"
    :title="`编辑产品 · ${itemDraft?.productName ?? ''}`"
    width="800px"
    :confirm-loading="bomSaving"
    ok-text="保存"
    @ok="saveBomDraft"
  >
    <AForm v-if="itemDraft" layout="vertical">
      <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <AFormItem label="产品名称" required>
<AInput v-model:value="itemDraft.productName" />
</AFormItem>
        <AFormItem label="产品型号">
<AInput
            :value="itemDraft.productModel ?? undefined"
            @update:value="itemDraft.productModel = $event"
        />
</AFormItem>
        <AFormItem label="尺寸规格(mm)">
<AInput
            :value="itemDraft.specificationMm ?? undefined"
            @update:value="itemDraft.specificationMm = $event"
        />
</AFormItem>
        <AFormItem label="原数量" required>
<AInput v-model:value="itemDraft.sourceQuantity" />
</AFormItem>
        <AFormItem label="计量类型" required>
          <ASelect
            :value="itemDraft.measurementKind"
            @change="selectMeasurementKind"
          >
            <ASelectOption
              v-for="kind in measurementKinds"
              :key="kind.id"
              :value="kind.itemValue"
              >
{{ kind.itemLabel }}
</ASelectOption>
          </ASelect>
        </AFormItem>
        <AFormItem label="ERP编码">
<AInput
            :value="itemDraft.erpCode ?? undefined"
            @update:value="itemDraft.erpCode = $event"
        />
</AFormItem>
        <AFormItem label="单价/¥">
<AInput
            :value="itemDraft.unitPrice ?? undefined"
            @update:value="itemDraft.unitPrice = $event || null"
        />
</AFormItem>
        <AFormItem label="总价/¥">
<AInput
            :value="itemDraft.totalPrice ?? undefined"
            @update:value="itemDraft.totalPrice = $event || null"
        />
</AFormItem>
        <AFormItem label="重量合计/kg">
<AInput
            :value="itemDraft.totalWeightKg ?? undefined"
            @update:value="itemDraft.totalWeightKg = $event || null"
        />
</AFormItem>
      </div>
      <AFormItem label="变更原因" required>
<AInput v-model:value="bomChangeReason" placeholder="填写变更原因" />
</AFormItem>
    </AForm>
  </AModal>

  <AModal
    v-model:open="productDetailVisible"
    title="产品详情"
    :footer="null"
    width="720px"
  >
    <ADescriptions v-if="selectedProduct" bordered size="small" :column="1">
      <ADescriptionsItem label="序号">
        {{ selectedProduct.ordinal }}
      </ADescriptionsItem>
      <ADescriptionsItem label="产品名称">
        <span class="break-all">{{ selectedProduct.productName }}</span>
      </ADescriptionsItem>
      <ADescriptionsItem label="产品型号">
        <span class="break-all">{{ selectedProduct.productModel ?? '—' }}</span>
      </ADescriptionsItem>
      <ADescriptionsItem label="尺寸规格(mm)">
        <span class="break-all">{{
          selectedProduct.specificationMm ?? '—'
        }}</span>
      </ADescriptionsItem>
      <ADescriptionsItem label="原数量">
        {{ selectedProduct.sourceQuantity }} {{ selectedProduct.sourceUnit }}
      </ADescriptionsItem>
      <ADescriptionsItem label="计量类型">
        {{
          measurementKindLabels[selectedProduct.measurementKind] ??
          selectedProduct.measurementKind
        }}
      </ADescriptionsItem>
      <ADescriptionsItem label="换算数量">
        {{ selectedProduct.quantity }} {{ selectedPricingUnit }}
      </ADescriptionsItem>
      <ADescriptionsItem label="单价/¥">
        {{ selectedProduct.unitPrice ?? '—' }}
      </ADescriptionsItem>
      <ADescriptionsItem label="总价/¥">
        {{ selectedProduct.totalPrice ?? '—' }}
      </ADescriptionsItem>
      <ADescriptionsItem label="重量合计/kg">
        {{ selectedProduct.totalWeightKg ?? '—' }}
      </ADescriptionsItem>
      <ADescriptionsItem label="ERP编码">
        <span class="break-all">{{ selectedProduct.erpCode ?? '—' }}</span>
      </ADescriptionsItem>
      <ADescriptionsItem label="来源工作表">
        <span class="break-all">{{ selectedProduct.sourceSheet ?? '—' }}</span>
      </ADescriptionsItem>
      <ADescriptionsItem label="来源行号">
        {{ selectedProduct.sourceRow ?? '—' }}
      </ADescriptionsItem>
    </ADescriptions>
  </AModal>

  <!-- 核验弹窗 -->
  <AModal
    v-model:open="verifyModalVisible"
    title="提交清单核验"
    :confirm-loading="verifySubmitting"
    @ok="handleVerifySubmit"
    ok-text="提交"
    cancel-text="取消"
  >
    <div class="space-y-4">
      <AForm layout="vertical">
        <AFormItem label="核验结论">
          <ARadioGroup v-model:value="verifyForm.decision">
            <ARadio value="pass">通过</ARadio>
            <ARadio value="reject">不通过</ARadio>
          </ARadioGroup>
        </AFormItem>

        <AFormItem
          v-if="verifyForm.decision === 'reject'"
          label="核验意见"
          required
        >
          <ATextarea
            v-model:value="verifyForm.notes"
            :rows="3"
            placeholder="不通过时请填写具体问题"
          />
        </AFormItem>
      </AForm>
    </div>
  </AModal>
</template>
