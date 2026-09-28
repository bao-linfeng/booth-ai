<script setup lang="ts">
import type { SchemeAsset } from '#/api/core/assets';
import type {
  BomImportResult,
  BomItem,
  BomRecord,
  BomUnitRule,
} from '#/api/core/bom';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { downloadFileFromBlob, formatDate } from '@vben/utils';

import {
  Button as AButton,
  Checkbox as ACheckbox,
  Divider as ADivider,
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

import { listSchemeAssetsApi } from '#/api/core/assets';
import {
  commitBomImportApi,
  downloadBomApi,
  getBomApi,
  submitBomVerificationApi,
  updateBomItemsApi,
  updateBomUnitRulesApi,
  uploadBomImportApi,
} from '#/api/core/bom';

const AFormItem = AForm.Item;
const ARadioGroup = ARadio.Group;
const ASelectOption = ASelect.Option;
const ATextarea = AInput.TextArea;

const route = useRoute();
const router = useRouter();

const currentCode = computed(() =>
  route.params.code ? decodeURIComponent(route.params.code as string) : '',
);

const modelAssets = ref<SchemeAsset[]>([]);

// BOM 清单工作区状态
const bomLoading = ref(false);
const bomData = ref<BomRecord | null>(null);
const bomImportResult = ref<BomImportResult | null>(null);
const bomImporting = ref(false);
const bomCommitting = ref(false);
const bomSaving = ref(false);
const bomEditRevision = ref<null | number>(null);
const editingItems = ref(false);
const editingRules = ref(false);
const itemDraft = ref<BomItem[]>([]);
const ruleDraft = ref<BomUnitRule[]>([]);
const bomChangeReason = ref('');
const warningConfirmations = ref<string[]>([]);
const verifyRequestKey = ref('');
let verificationAttempt: null | {
  code: string;
  payload: Parameters<typeof submitBomVerificationApi>[1];
} = null;
let bomRequestSequence = 0;
const hasBom = computed(
  () => !!bomData.value && bomData.value.status !== 'absent',
);
const warningCodes = computed(() => [
  ...new Set(bomImportResult.value?.warnings.map((w) => w.code) ?? []),
]);

// 核验弹窗
const verifyModalVisible = ref(false);
const verifySubmitting = ref(false);
const verifyForm = reactive({
  decision: 'pass' as 'pass' | 'reject',
  sourceExtraction: false,
  modelCrossCheck: false,
  supportingParts: false,
  unitConsistency: false,
  modelAssetId: '',
  notes: '',
});

async function fetchModelAssets() {
  if (!currentCode.value) return;
  try {
    modelAssets.value = await listSchemeAssetsApi(currentCode.value, 'model');
  } catch {
    modelAssets.value = [];
  }
}

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
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xlsm';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
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
      warningConfirmations.value = [];
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
  if (!bomImportResult.value || bomCommitting.value || bomLoading.value) return;
  const requestCode = currentCode.value;
  bomCommitting.value = true;
  try {
    const result = await commitBomImportApi(
      requestCode,
      bomImportResult.value.importId,
      {
        expectedRevision: bomImportResult.value.baseRevision,
        confirmedWarningCodes: warningConfirmations.value,
        changeReason: bomChangeReason.value.trim(),
      },
    );
    if (currentCode.value !== requestCode) return;
    message.success(`导入成功，清单已更新至修订版本 ${result.revision}`);
    if (result.unpublished) message.warning('方案已自动下架，请重新审核后发布');
    bomImportResult.value = null;
    await fetchBom();
  } catch (error: any) {
    if (error?.response?.status === 409)
      message.warning('清单修订或导入请求已变化，请核对后重新导入');
  } finally {
    bomCommitting.value = false;
  }
}

function openVerifyModal() {
  if (!hasBom.value || bomLoading.value) return;
  verifyRequestKey.value = crypto.randomUUID();
  verificationAttempt = null;
  verifyForm.decision = 'pass';
  verifyForm.sourceExtraction = false;
  verifyForm.modelCrossCheck = false;
  verifyForm.supportingParts = false;
  verifyForm.unitConsistency = false;
  verifyForm.modelAssetId = bomData.value?.modelAssetId ?? '';
  verifyForm.notes = '';
  verifyModalVisible.value = true;
}

async function handleVerifySubmit() {
  if (!bomData.value || !hasBom.value) return;
  verifySubmitting.value = true;
  try {
    const payload = {
      requestKey: verifyRequestKey.value,
      expectedRevision: bomData.value.revision,
      decision: verifyForm.decision,
      checks: {
        sourceExtraction: verifyForm.sourceExtraction,
        modelCrossCheck: verifyForm.modelCrossCheck,
        supportingParts: verifyForm.supportingParts,
        unitConsistency: verifyForm.unitConsistency,
      },
      modelAssetId: verifyForm.modelAssetId || undefined,
      notes: verifyForm.notes || undefined,
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
  } catch (error: any) {
    message.error(error?.message || '提交核验失败');
  } finally {
    verifySubmitting.value = false;
  }
}

function startItemEdit() {
  if (!hasBom.value || !bomData.value) return;
  itemDraft.value = bomData.value.items.map((item) => ({ ...item }));
  bomEditRevision.value = bomData.value.revision;
  editingRules.value = false;
  editingItems.value = true;
}
function startRuleEdit() {
  if (!hasBom.value || !bomData.value) return;
  ruleDraft.value = bomData.value.unitRules.map((rule) => ({ ...rule }));
  bomEditRevision.value = bomData.value.revision;
  editingItems.value = false;
  editingRules.value = true;
}
function moveItem(index: number, direction: number) {
  const target = index + direction;
  if (target < 0 || target >= itemDraft.value.length) return;
  const item = itemDraft.value[index]!;
  itemDraft.value[index] = itemDraft.value[target]!;
  itemDraft.value[target] = item;
}
function addItem() {
  if (!bomData.value?.unitRules[0]) return;
  itemDraft.value.push({
    id: crypto.randomUUID(),
    bomId: bomData.value.id ?? '',
    ordinal: itemDraft.value.length + 1,
    productName: '',
    productModel: null,
    specificationMm: null,
    sourceQuantity: '1',
    sourceUnit: bomData.value.unitRules[0].sourceUnit,
    quantity: '1',
    unitRuleId: bomData.value.unitRules[0].id,
    erpCode: null,
    sourceSheet: null,
    sourceRow: null,
    diffNote: null,
  });
}
function addRule() {
  ruleDraft.value.push({
    id: crypto.randomUUID(),
    bomId: bomData.value?.id ?? '',
    measurementKind: 'count',
    sourceUnit: '',
    pricingUnit: '',
    conversionCode: 'identity',
  });
}
async function saveBomDraft() {
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
    if (editingItems.value) {
      await updateBomItemsApi(currentCode.value, {
        expectedRevision: bomEditRevision.value,
        changeReason: bomChangeReason.value.trim(),
        items: itemDraft.value.map((item) => ({
          ...(bomData.value?.items.some((old) => old.id === item.id)
            ? { id: item.id }
            : {}),
          productName: item.productName,
          productModel: item.productModel,
          specificationMm: item.specificationMm,
          sourceQuantity: item.sourceQuantity,
          sourceUnit: item.sourceUnit,
          unitRuleId: item.unitRuleId ?? undefined,
          erpCode: item.erpCode,
          diffNote: item.diffNote,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        })),
      });
    } else {
      await updateBomUnitRulesApi(currentCode.value, {
        expectedRevision: bomEditRevision.value,
        changeReason: bomChangeReason.value.trim(),
        unitRules: ruleDraft.value.map((rule) => ({
          ...(bomData.value?.unitRules.some((old) => old.id === rule.id)
            ? { id: rule.id }
            : {}),
          measurementKind: rule.measurementKind,
          sourceUnit: rule.sourceUnit,
          pricingUnit: rule.pricingUnit,
          conversionCode: rule.conversionCode,
        })),
      });
    }
    editingItems.value = false;
    editingRules.value = false;
    bomEditRevision.value = null;
    await fetchBom();
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

watch(currentCode, () => {
  bomRequestSequence++;
  bomData.value = null;
  bomImportResult.value = null;
  verifyModalVisible.value = false;
  verifyRequestKey.value = '';
  verificationAttempt = null;
  editingItems.value = false;
  editingRules.value = false;
  bomEditRevision.value = null;
  itemDraft.value = [];
  ruleDraft.value = [];
  warningConfirmations.value = [];
  if (currentCode.value) {
    fetchBom();
    fetchModelAssets();
  }
});

onMounted(() => {
  if (currentCode.value) {
    fetchBom();
    fetchModelAssets();
  }
});

function handleBack() {
  router.push(`/scheme/detail/${encodeURIComponent(currentCode.value)}`);
}
</script>

<template>
  <div class="space-y-4 p-4 min-h-full">
    <div
      class="border-border bg-background flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 shadow-sm"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <AButton
          class="flex items-center gap-1 p-0"
          type="link"
          @click="handleBack"
        >
          <span class="icon-[lucide--arrow-left]"></span>
          返回
        </AButton>
        <h2 class="m-0 break-all text-xl font-semibold">
          简化清单: {{ currentCode }}
        </h2>
      </div>
    </div>
  </div>

  <div class="border-border bg-background rounded-lg border p-4 shadow-sm">
    <div v-loading="bomLoading" class="space-y-4">
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
        <div class="flex flex-wrap gap-2">
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
            :disabled="bomLoading"
            size="small"
            type="primary"
            ghost
            @click="openVerifyModal"
          >
            提交核验
          </AButton>
          <AButton
            size="small"
            :disabled="bomLoading"
            :loading="bomImporting"
            @click="handleBomImport"
          >
            导入 XLSX/XLSM
          </AButton>
        </div>
      </div>

      <!-- 导入预览区 -->
      <div
        v-if="bomImportResult"
        class="border-border bg-muted/50 space-y-3 rounded-lg border p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-medium">导入预览</span>
          <AButton size="small" @click="bomImportResult = null"> 取消 </AButton>
        </div>
        <div class="text-muted-foreground space-y-1 text-sm">
          <div>文件：{{ bomImportResult.sourceFileName }}</div>
          <div>基础修订：{{ bomImportResult.baseRevision }}</div>
          <div>可提交：{{ bomImportResult.canCommit ? '是' : '否' }}</div>
        </div>
        <AInput
          v-model:value="bomChangeReason"
          placeholder="填写导入变更原因（必填）"
        />
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
          <div v-for="code in warningCodes" :key="code" class="mt-1">
            <ACheckbox
              :checked="warningConfirmations.includes(code)"
              @change="
                (event: { target: { checked: boolean } }) => {
                  warningConfirmations = event.target.checked
                    ? [...warningConfirmations, code]
                    : warningConfirmations.filter((value) => value !== code);
                }
              "
            >
              我已核对并确认 {{ code }}（{{
                bomImportResult.warnings.filter((warn) => warn.code === code)
                  .length
              }}
              条）
            </ACheckbox>
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
              { title: '单位', dataIndex: 'sourceUnit' },
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
            :disabled="
              !bomImportResult.canCommit ||
              !bomChangeReason.trim() ||
              warningCodes.some(
                (code) => !warningConfirmations.includes(code),
              ) ||
              bomLoading
            "
            :loading="bomCommitting"
            @click="handleBomCommit"
          >
            {{ bomImportResult.canCommit ? '确认提交' : '存在错误，无法提交' }}
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
            { title: '原单位', dataIndex: 'sourceUnit', width: 80 },
            { title: 'ERP编码', dataIndex: 'erpCode', width: 120 },
            {
              title: '差异说明',
              dataIndex: 'diffNote',
              ellipsis: true,
            },
          ]"
          :pagination="{ pageSize: 20, showSizeChanger: false }"
          size="small"
          row-key="id"
          :scroll="{ x: 1000 }"
        />
      </div>

      <!-- 空状态 -->
      <AEmpty
        v-if="!hasBom || bomData?.items.length === 0"
        description="暂无清单数据，请上传 XLSX/XLSM 文件导入"
      />

      <!-- 计量单位规则 -->
      <div v-if="hasBom && bomData && bomData.unitRules.length > 0">
        <ADivider orientation="left">计量单位规则</ADivider>
        <ATable
          :data-source="bomData.unitRules"
          :columns="[
            {
              title: '计量类型',
              dataIndex: 'measurementKind',
              customRender: ({ text }: { text: string }) =>
                (
                  ({
                    count: '个数',
                    length: '长度',
                    area: '面积',
                  }) as Record<string, string>
                )[text] ?? text,
            },
            { title: '源单位', dataIndex: 'sourceUnit' },
            { title: '计价单位', dataIndex: 'pricingUnit' },
            {
              title: '换算',
              dataIndex: 'conversionCode',
              customRender: ({ text }: { text: string }) =>
                (
                  ({
                    identity: '×1',
                    mm_to_m: '÷1000',
                    mm2_to_m2: '÷1000000',
                  }) as Record<string, string>
                )[text] ?? text,
            },
          ]"
          :pagination="false"
          size="small"
          row-key="id"
        />
      </div>
      <div v-if="hasBom" class="flex gap-2">
        <AButton :disabled="bomLoading" @click="startItemEdit">
          维护条目
        </AButton>
        <AButton :disabled="bomLoading" @click="startRuleEdit">
          维护计量规则
        </AButton>
      </div>
      <div
        v-if="editingItems || editingRules"
        class="space-y-3 rounded-lg border p-4"
      >
        <div v-if="editingItems" class="space-y-2 overflow-x-auto">
          <div
            v-for="(item, index) in itemDraft"
            :key="item.id"
            class="flex min-w-[1000px] items-center gap-2"
          >
            <AButton
              size="small"
              :disabled="index === 0"
              @click="moveItem(index, -1)"
            >
              ↑
            </AButton>
            <AButton
              size="small"
              :disabled="index === itemDraft.length - 1"
              @click="moveItem(index, 1)"
            >
              ↓
            </AButton>
            <AInput v-model:value="item.productName" placeholder="产品名称" />
            <AInput
              :value="item.productModel ?? undefined"
              @update:value="item.productModel = $event"
              placeholder="型号"
            />
            <AInput
              :value="item.specificationMm ?? undefined"
              @update:value="item.specificationMm = $event"
              placeholder="规格(mm)"
            />
            <AInput v-model:value="item.sourceQuantity" placeholder="源数量" />
            <ASelect
              :value="item.unitRuleId ?? undefined"
              @update:value="
                item.unitRuleId = typeof $event === 'string' ? $event : null
              "
              class="min-w-32"
              @change="
                (id) => {
                  if (typeof id === 'string') {
                    item.sourceUnit =
                      bomData?.unitRules.find((rule) => rule.id === id)
                        ?.sourceUnit ?? item.sourceUnit;
                  }
                }
              "
            >
              <ASelectOption
                v-for="rule in bomData?.unitRules"
                :key="rule.id"
                :value="rule.id"
              >
                {{ rule.sourceUnit }} →
                {{ rule.pricingUnit }}
              </ASelectOption>
            </ASelect>
            <AInput
              :value="item.erpCode ?? undefined"
              @update:value="item.erpCode = $event"
              placeholder="ERP"
            />
            <AInput
              :value="item.diffNote ?? undefined"
              @update:value="item.diffNote = $event"
              placeholder="差异说明"
            />
            <AButton
              danger
              :disabled="itemDraft.length === 1"
              @click="itemDraft.splice(index, 1)"
            >
              删除
            </AButton>
          </div>
          <AButton @click="addItem">新增条目</AButton>
        </div>
        <div v-if="editingRules" class="space-y-2">
          <div
            v-for="(rule, index) in ruleDraft"
            :key="rule.id"
            class="flex items-center gap-2"
          >
            <ASelect v-model:value="rule.measurementKind" class="min-w-24">
              <ASelectOption value="count">个数</ASelectOption><ASelectOption value="length">长度</ASelectOption><ASelectOption value="area"> 面积 </ASelectOption>
            </ASelect>
            <AInput v-model:value="rule.sourceUnit" placeholder="源单位" />
            <AInput v-model:value="rule.pricingUnit" placeholder="计价单位" />
            <ASelect v-model:value="rule.conversionCode" class="min-w-32">
              <ASelectOption value="identity">×1</ASelectOption><ASelectOption value="mm_to_m">mm → m</ASelectOption><ASelectOption value="mm2_to_m2"> mm² → m² </ASelectOption>
            </ASelect>
            <AButton
              danger
              :disabled="
                ruleDraft.length === 1 ||
                !!bomData?.items.some((item) => item.unitRuleId === rule.id)
              "
              @click="ruleDraft.splice(index, 1)"
            >
              删除
            </AButton>
          </div>
          <p class="text-muted-foreground text-xs">
            被条目引用的规则不可删除；更改源单位前请先调整条目。
          </p>
          <AButton @click="addRule">新增规则</AButton>
        </div>
        <AInput
          v-model:value="bomChangeReason"
          placeholder="填写变更原因（必填）"
        />
        <div class="flex gap-2">
          <AButton type="primary" :loading="bomSaving" @click="saveBomDraft">
            保存
          </AButton>
          <AButton
            @click="
              editingItems = false;
              editingRules = false;
            "
          >
            取消
          </AButton>
        </div>
      </div>
    </div>
  </div>

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

        <AFormItem label="逐项确认（通过时全部需勾选）">
          <div class="space-y-2">
            <ACheckbox v-model:checked="verifyForm.sourceExtraction">
              提取一致性：源行与提取行对应，数值与ERP保真
            </ACheckbox>
            <ACheckbox v-model:checked="verifyForm.modelCrossCheck">
              模型逐项核对：型号、规格、数量与SKP一致
            </ACheckbox>
            <ACheckbox v-model:checked="verifyForm.supportingParts">
              配套项确认：连接件、支撑件及配套项已检查
            </ACheckbox>
            <ACheckbox v-model:checked="verifyForm.unitConsistency">
              单位一致性：个数/长度/面积口径与SU一致
            </ACheckbox>
          </div>
        </AFormItem>

        <AFormItem label="绑定模型资产（通过时必填）">
          <ASelect
            v-model:value="verifyForm.modelAssetId"
            placeholder="选择模型文件"
            class="w-full"
          >
            <ASelectOption
              v-for="asset in modelAssets.filter(
                (asset) => asset.isActive && asset.currentVersion,
              )"
              :key="asset.id"
              :value="asset.id"
            >
              {{ asset.name }} ·
              {{ asset.currentVersion?.originalFilename }}
            </ASelectOption>
          </ASelect>
        </AFormItem>

        <AFormItem label="核验意见">
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
