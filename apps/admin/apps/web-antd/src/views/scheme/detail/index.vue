<script setup lang="ts">
import type { SchemeAsset } from '#/api/core/assets';
import type {
  BomImportResult,
  BomItem,
  BomRecord,
  BomUnitRule,
} from '#/api/core/bom';
import type { ReadinessResult } from '#/api/core/reviews';
import type {
  CreateSchemeInput,
  SchemeRecord,
  UpdateSchemeInput,
} from '#/api/core/schemes';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { downloadFileFromBlob, formatDate } from '@vben/utils';

import { message } from 'ant-design-vue';

import {
  getAssetDownloadUrlApi,
  listSchemeAssetsApi,
  uploadAssetApi,
} from '#/api/core/assets';
import {
  commitBomImportApi,
  downloadBomApi,
  getBomApi,
  submitBomVerificationApi,
  updateBomItemsApi,
  updateBomUnitRulesApi,
  uploadBomImportApi,
} from '#/api/core/bom';
import {
  createSchemeReviewApi,
  getSchemeReadinessApi,
  publishSchemeApi,
  unpublishSchemeApi,
} from '#/api/core/reviews';
import {
  createSchemeApi,
  getCatalogOptionsApi,
  getSchemeDetailApi,
  updateSchemeApi,
} from '#/api/core/schemes';

const route = useRoute();
const router = useRouter();

const isCreate = computed(() => route.path === '/scheme/create');
const currentCode = computed(() =>
  route.params.code ? decodeURIComponent(route.params.code as string) : '',
);

const loading = ref(false);
const saving = ref(false);
const activeTab = ref('basic');

const formRef = ref();

const formData = reactive<CreateSchemeInput & { expectedRevision?: number }>({
  code: '',
  name: '',
  parentCode: undefined,
  description: undefined,
  lengthCm: undefined,
  widthCm: undefined,
  heightCm: undefined,
  areaSqm: undefined,
  openingCount: undefined,
  productLine: undefined,
  style: undefined,
  industries: [],
  budgetTier: undefined,
  keywords: [],
  notes: undefined,
  openingDirections: [],
  functionalZones: [],
  keyFeatures: [],
  source: undefined,
});

const originalData = ref<null | SchemeRecord>(null);

const modelAssets = ref<SchemeAsset[]>([]);
const modelUploading = ref(false);

const assetCounts = reactive({
  rendering: 0,
  mask: 0,
  drawing: 0,
  artwork: 0,
  model: 0,
  checklist: 0,
});

const options = reactive({
  styles: [] as { label: string; value: string }[],
  industries: [] as { label: string; value: string }[],
  productLines: [] as { label: string; value: string }[],
  budgetTiers: [] as { label: string; value: string }[],
  openingDirections: [] as { label: string; value: string }[],
});

async function fetchOptions() {
  try {
    const res = await getCatalogOptionsApi(
      'style,industry,productLine,budgetTier,openingDirection',
    );
    if (res) {
      if (res.style)
        options.styles = res.style.map((o) => ({
          label: o.label,
          value: o.key,
        }));
      if (res.industry)
        options.industries = res.industry.map((o) => ({
          label: o.label,
          value: o.key,
        }));
      if (res.productLine)
        options.productLines = res.productLine.map((o) => ({
          label: o.label,
          value: o.key,
        }));
      if (res.budgetTier)
        options.budgetTiers = res.budgetTier.map((o) => ({
          label: o.label,
          value: o.key,
        }));
      if (res.openingDirection)
        options.openingDirections = res.openingDirection.map((o) => ({
          label: o.label,
          value: o.key,
        }));
    }
  } catch (error) {
    console.error('Failed to load catalog options:', error);
  }
}

async function fetchDetail() {
  if (isCreate.value || !currentCode.value) return;
  const requestCode = currentCode.value;
  const sequence = ++detailRequestSequence;
  loading.value = true;
  try {
    const res = await getSchemeDetailApi(requestCode);
    if (sequence !== detailRequestSequence || requestCode !== currentCode.value)
      return;
    originalData.value = res;

    // Fetch asset counts
    const assets = await listSchemeAssetsApi(requestCode);
    if (sequence !== detailRequestSequence || requestCode !== currentCode.value)
      return;
    assetCounts.rendering = assets.filter((a) => a.type === 'rendering').length;
    assetCounts.mask = assets.filter((a) => a.type === 'mask').length;
    assetCounts.drawing = assets.filter((a) => a.type === 'drawing').length;
    assetCounts.artwork = assets.filter((a) => a.type === 'artwork').length;
    assetCounts.model = assets.filter((a) => a.type === 'model').length;
    assetCounts.checklist = assets.filter((a) => a.type === 'checklist').length;
    modelAssets.value = assets.filter((a) => a.type === 'model');

    // Populate form
    Object.keys(formData).forEach((key) => {
      const k = key as keyof typeof formData;
      if (
        k !== 'expectedRevision' &&
        res[k as keyof SchemeRecord] !== undefined &&
        res[k as keyof SchemeRecord] !== null
      ) {
        (formData as any)[k] = res[k as keyof SchemeRecord];
      }
    });
    formData.expectedRevision = res.revision;
  } catch (error: any) {
    message.error(error.message || '获取方案详情失败');
  } finally {
    if (sequence === detailRequestSequence) loading.value = false;
  }
}

async function fetchModelAssets() {
  if (!currentCode.value) return;
  try {
    modelAssets.value = await listSchemeAssetsApi(currentCode.value, 'model');
  } catch {
    modelAssets.value = [];
  }
}

async function handleModelUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.skp';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    modelUploading.value = true;
    try {
      await uploadAssetApi(currentCode.value, {
        type: 'model',
        name: file.name,
        file,
      });
      message.success('模型上传成功');
      await fetchModelAssets();
      assetCounts.model = modelAssets.value.length;
    } catch {
      message.error('上传失败');
    } finally {
      modelUploading.value = false;
    }
  });
  input.click();
}

async function handleModelDownload(asset: SchemeAsset) {
  try {
    const res = await getAssetDownloadUrlApi(
      currentCode.value,
      asset.id,
      'attachment',
    );
    window.open(res.url, '_blank');
  } catch {
    message.error('获取下载链接失败');
  }
}

function calculateArea() {
  if (formData.lengthCm && formData.widthCm) {
    formData.areaSqm = Number(
      ((formData.lengthCm * formData.widthCm) / 10_000).toFixed(2),
    );
  }
}

async function handleSave() {
  try {
    await formRef.value.validate();
  } catch {
    message.warning('请检查表单填写');
    return;
  }

  saving.value = true;
  try {
    if (isCreate.value) {
      const res = await createSchemeApi(formData as CreateSchemeInput);
      message.success('创建成功');
      router.replace(`/scheme/detail/${encodeURIComponent(res.code)}`);
    } else {
      const payload: UpdateSchemeInput = {
        ...formData,
        expectedRevision: formData.expectedRevision!,
      };
      const res = await updateSchemeApi(currentCode.value, payload);
      message.success('保存成功');
      originalData.value = res;
      formData.expectedRevision = res.revision;
    }
  } catch (error: any) {
    if (
      error.response?.status === 409 ||
      error.status === 409 ||
      error.code === '409'
    ) {
      message.error('数据已被他人修改，请刷新后重试');
    } else {
      message.error(error.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

function handleBack() {
  router.push('/scheme/list');
}

async function fetchReadiness() {
  if (!currentCode.value) return;
  readinessLoading.value = true;
  try {
    readinessData.value = await getSchemeReadinessApi(currentCode.value);
  } catch (error: any) {
    message.error(error?.message || '获取就绪状态失败');
  } finally {
    readinessLoading.value = false;
  }
}

function openReviewModal() {
  reviewRequestKey.value = crypto.randomUUID();
  reviewForm.phase = 'overall';
  reviewForm.decision = 'pass';
  reviewForm.checks.assetsComplete = false;
  reviewForm.checks.bomVerified = false;
  reviewForm.checks.renderingsAndMasks = false;
  reviewForm.checks.drawingsComplete = false;
  reviewForm.notes = '';
  reviewModalVisible.value = true;
}

async function handleReviewSubmit() {
  if (!originalData.value) return;
  reviewSubmitting.value = true;
  try {
    await createSchemeReviewApi(currentCode.value, {
      requestKey: reviewRequestKey.value,
      schemeRevision: originalData.value.revision,
      phase: reviewForm.phase,
      decision: reviewForm.decision,
      checks: { ...reviewForm.checks },
      notes: reviewForm.notes || null,
    });
    message.success(
      reviewForm.decision === 'pass' ? '审核通过' : '审核不通过已记录',
    );
    reviewModalVisible.value = false;
    await fetchDetail();
    await fetchReadiness();
  } catch (error: any) {
    if (error?.response?.status === 409 || error?.status === 409) {
      message.error('方案已被修改，请刷新后重试');
    } else {
      message.error(error?.message || '提交审核失败');
    }
  } finally {
    reviewSubmitting.value = false;
  }
}

async function handlePublish() {
  publishLoading.value = true;
  try {
    await publishSchemeApi(currentCode.value);
    message.success('方案已发布');
    await fetchDetail();
    await fetchReadiness();
  } catch (error: any) {
    message.error(error?.message || '发布失败');
  } finally {
    publishLoading.value = false;
  }
}

function openUnpublishModal() {
  unpublishReason.value = '';
  unpublishModalVisible.value = true;
}

async function handleUnpublishSubmit() {
  unpublishSubmitting.value = true;
  try {
    await unpublishSchemeApi(
      currentCode.value,
      unpublishReason.value || undefined,
    );
    message.success('方案已下架');
    unpublishModalVisible.value = false;
    await fetchDetail();
    await fetchReadiness();
  } catch (error: any) {
    message.error(error?.message || '下架失败');
  } finally {
    unpublishSubmitting.value = false;
  }
}

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
let detailRequestSequence = 0;
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

// 就绪检查
const readinessLoading = ref(false);
const readinessData = ref<null | ReadinessResult>(null);

// 整体审核弹窗
const reviewModalVisible = ref(false);
const reviewSubmitting = ref(false);
const reviewRequestKey = ref('');
const reviewForm = reactive({
  phase: 'overall' as 'asset_verification' | 'overall',
  decision: 'pass' as 'pass' | 'reject',
  checks: {
    assetsComplete: false,
    bomVerified: false,
    renderingsAndMasks: false,
    drawingsComplete: false,
  },
  notes: '',
});

// 下架弹窗
const unpublishModalVisible = ref(false);
const unpublishSubmitting = ref(false);
const unpublishReason = ref('');

// 发布 loading
const publishLoading = ref(false);

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
    await fetchDetail();
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
    await fetchDetail();
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
    await fetchDetail();
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
  detailRequestSequence++;
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
  originalData.value = null;
  if (currentCode.value) {
    fetchDetail();
    if (activeTab.value === 'checklist') fetchBom();
    if (activeTab.value === 'publish') fetchReadiness();
  }
});

watch(activeTab, (tab) => {
  if (
    tab === 'checklist' &&
    currentCode.value &&
    !bomData.value &&
    !bomLoading.value
  ) {
    fetchBom();
  }
  if (
    tab === 'publish' &&
    currentCode.value &&
    !readinessData.value &&
    !readinessLoading.value
  ) {
    fetchReadiness();
  }
});

onMounted(() => {
  fetchOptions();
  fetchDetail();
});
</script>

<template>
  <div class="p-4" v-loading="loading">
    <div
      class="mb-4 bg-background p-4 rounded-lg shadow-sm flex justify-between items-center"
    >
      <div class="flex items-center gap-4">
        <a-button
          type="link"
          @click="handleBack"
          class="p-0 flex items-center gap-1"
        >
          <span class="icon-[lucide--arrow-left]"></span>
          返回
        </a-button>
        <h2 class="text-xl font-medium m-0">
          {{ isCreate ? '新建方案' : `方案详情: ${currentCode}` }}
        </h2>

        <div v-if="!isCreate && originalData" class="flex gap-2 ml-4">
          <a-tag
            v-if="originalData.publishStatus === 'published'"
            color="green"
          >
            已发布
          </a-tag>
          <a-tag
            v-else-if="originalData.publishStatus === 'unpublished'"
            color="orange"
          >
            未发布
          </a-tag>
          <a-tag v-else>草稿</a-tag>

          <a-tag
            v-if="originalData.verificationStatus === 'verified'"
            color="green"
          >
            核验通过
          </a-tag>
          <a-tag
            v-else-if="originalData.verificationStatus === 'failed'"
            color="red"
          >
            核验失败
          </a-tag>
          <a-tag v-else>未核验</a-tag>
        </div>
      </div>
      <div class="flex gap-2">
        <a-button type="primary" :loading="saving" @click="handleSave">
          保存草稿
        </a-button>
        <template v-if="!isCreate && originalData">
          <a-button
            v-if="originalData.publishStatus !== 'published'"
            type="primary"
            ghost
            @click="openReviewModal"
          >
            整体审核
          </a-button>
          <a-button
            v-if="originalData.publishStatus !== 'published'"
            type="primary"
            :loading="publishLoading"
            @click="handlePublish"
          >
            发布
          </a-button>
          <a-button
            v-if="originalData.publishStatus === 'published'"
            danger
            @click="openUnpublishModal"
          >
            下架
          </a-button>
        </template>
      </div>
    </div>

    <div class="bg-background p-4 rounded-lg shadow-sm">
      <a-form ref="formRef" :model="formData" layout="vertical">
        <a-tabs v-model:active-key="activeTab">
          <a-tab-pane key="basic" tab="基础信息">
            <div class="grid grid-cols-2 gap-4">
              <a-form-item
                label="方案编号"
                name="code"
                :rules="[{ required: true, message: '请输入方案编号' }]"
              >
                <a-input
                  v-model:value="formData.code"
                  :disabled="!isCreate"
                  placeholder="如: SCH-001"
                />
              </a-form-item>

              <a-form-item
                label="方案名称"
                name="name"
                :rules="[{ required: true, message: '请输入方案名称' }]"
              >
                <a-input
                  v-model:value="formData.name"
                  placeholder="请输入方案名称"
                />
              </a-form-item>

              <a-form-item label="来源" name="source">
                <a-input
                  v-model:value="formData.source"
                  placeholder="请输入来源"
                />
              </a-form-item>

              <a-form-item label="母方案编号" name="parentCode">
                <a-input
                  v-model:value="formData.parentCode"
                  placeholder="可选填已有方案编号"
                />
              </a-form-item>
            </div>

            <a-form-item label="一句话描述" name="description">
              <a-textarea
                v-model:value="formData.description"
                :rows="3"
                placeholder="请输入描述"
              />
            </a-form-item>

            <a-form-item label="备注" name="notes">
              <a-textarea
                v-model:value="formData.notes"
                :rows="3"
                placeholder="请输入备注"
              />
            </a-form-item>

            <a-divider orientation="left">空间信息</a-divider>
            <div class="grid grid-cols-4 gap-4">
              <a-form-item label="长 (cm)" name="lengthCm">
                <a-input-number
                  v-model:value="formData.lengthCm"
                  @change="calculateArea"
                  class="w-full"
                  :min="0"
                />
              </a-form-item>

              <a-form-item label="宽 (cm)" name="widthCm">
                <a-input-number
                  v-model:value="formData.widthCm"
                  @change="calculateArea"
                  class="w-full"
                  :min="0"
                />
              </a-form-item>

              <a-form-item label="高 (cm)" name="heightCm">
                <a-input-number
                  v-model:value="formData.heightCm"
                  class="w-full"
                  :min="0"
                />
              </a-form-item>

              <a-form-item label="面积 (m²)" name="areaSqm">
                <a-input-number
                  v-model:value="formData.areaSqm"
                  class="w-full"
                  :min="0"
                />
              </a-form-item>
            </div>
          </a-tab-pane>

          <a-tab-pane key="tags" tab="打标">
            <div class="grid grid-cols-2 gap-4">
              <a-form-item label="产品体系" name="productLine">
                <a-select
                  v-model:value="formData.productLine"
                  :options="options.productLines"
                  placeholder="请选择"
                  allow-clear
                />
              </a-form-item>

              <a-form-item label="风格" name="style">
                <a-select
                  v-model:value="formData.style"
                  :options="options.styles"
                  placeholder="请选择"
                  allow-clear
                />
              </a-form-item>

              <a-form-item label="适用行业" name="industries">
                <a-select
                  v-model:value="formData.industries"
                  :options="options.industries"
                  mode="multiple"
                  placeholder="请选择"
                  allow-clear
                />
              </a-form-item>

              <a-form-item label="预算档位" name="budgetTier">
                <a-select
                  v-model:value="formData.budgetTier"
                  :options="options.budgetTiers"
                  placeholder="请选择"
                  allow-clear
                />
              </a-form-item>

              <a-form-item label="开口面数" name="openingCount">
                <a-input-number
                  v-model:value="formData.openingCount"
                  class="w-full"
                  :min="0"
                  :max="4"
                />
              </a-form-item>

              <a-form-item label="开口方向" name="openingDirections">
                <a-select
                  v-model:value="formData.openingDirections"
                  :options="options.openingDirections"
                  mode="multiple"
                  placeholder="请选择"
                  allow-clear
                />
              </a-form-item>

              <a-form-item label="功能分区" name="functionalZones">
                <a-select
                  v-model:value="formData.functionalZones"
                  mode="tags"
                  placeholder="输入并回车添加"
                />
              </a-form-item>

              <a-form-item label="关键特征" name="keyFeatures">
                <a-select
                  v-model:value="formData.keyFeatures"
                  mode="tags"
                  placeholder="输入并回车添加"
                />
              </a-form-item>

              <a-form-item label="关键词" name="keywords" class="col-span-2">
                <a-select
                  v-model:value="formData.keywords"
                  mode="tags"
                  placeholder="输入并回车添加关键词"
                />
              </a-form-item>
            </div>
          </a-tab-pane>

          <a-tab-pane v-if="!isCreate" key="model" tab="模型">
            <div class="flex justify-between items-center mb-4">
              <span class="text-sm text-gray-500">共 {{ modelAssets.length }} 个模型文件</span>
              <a-button
                type="primary"
                :loading="modelUploading"
                @click="handleModelUpload"
              >
                上传模型（.skp）
              </a-button>
            </div>
            <a-empty
              v-if="modelAssets.length === 0"
              description="暂无模型文件"
            />
            <div v-else class="space-y-3">
              <div
                v-for="asset in modelAssets"
                :key="asset.id"
                class="flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-4 py-3"
              >
                <div>
                  <div class="font-medium">{{ asset.name }}</div>
                  <div class="text-xs text-gray-400 mt-1">
                    {{ asset.currentVersion?.originalFilename || '未上传文件' }}
                    · {{ formatDate(asset.createdAt) }}
                  </div>
                </div>
                <a-button
                  v-if="asset.currentVersion"
                  type="link"
                  size="small"
                  @click="handleModelDownload(asset)"
                >
                  下载
                </a-button>
              </div>
            </div>
          </a-tab-pane>

          <a-tab-pane v-if="!isCreate" key="assets" tab="资产汇总">
            <div class="grid grid-cols-3 gap-6">
              <a-card
                hoverable
                class="text-center"
                @click="
                  router.push(`/assets/renderings?schemeCode=${currentCode}`)
                "
              >
                <div class="text-gray-500 mb-2">效果图</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.rendering }}
                </div>
              </a-card>
              <a-card
                hoverable
                class="text-center"
                @click="router.push(`/assets/masks?schemeCode=${currentCode}`)"
              >
                <div class="text-gray-500 mb-2">蒙版</div>
                <div class="text-2xl font-semibold">{{ assetCounts.mask }}</div>
              </a-card>
              <a-card
                hoverable
                class="text-center"
                @click="
                  router.push(
                    `/assets/venue-materials?schemeCode=${currentCode}`,
                  )
                "
              >
                <div class="text-gray-500 mb-2">报馆图</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.drawing }}
                </div>
              </a-card>
              <a-card
                hoverable
                class="text-center"
                @click="
                  router.push(`/assets/artworks?schemeCode=${currentCode}`)
                "
              >
                <div class="text-gray-500 mb-2">平面素材</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.artwork }}
                </div>
              </a-card>
              <a-card hoverable class="text-center">
                <div class="text-gray-500 mb-2">模型</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.model }}
                </div>
              </a-card>
              <a-card hoverable class="text-center">
                <div class="text-gray-500 mb-2">清单</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.checklist }}
                </div>
              </a-card>
            </div>
          </a-tab-pane>

          <a-tab-pane v-if="!isCreate" key="checklist" tab="简化清单">
            <div v-loading="bomLoading" class="space-y-4">
              <!-- 状态栏 -->
              <div
                class="flex items-center justify-between rounded-lg border bg-gray-50 px-4 py-3"
              >
                <div class="flex items-center gap-3">
                  <span class="text-sm font-medium text-gray-600">清单状态</span>
                  <a-tag v-if="!hasBom" color="default">无清单</a-tag>
                  <a-tag
                    v-else-if="bomData && bomData.status === 'verified'"
                    color="success"
                  >
                    已核验
                  </a-tag>
                  <a-tag
                    v-else-if="bomData && bomData.status === 'rejected'"
                    color="error"
                  >
                    核验不通过
                  </a-tag>
                  <a-tag v-else color="warning">待核验</a-tag>
                  <span v-if="hasBom" class="text-xs text-gray-400">修订版本 {{ bomData?.revision }}</span>
                  <span v-if="bomData?.verifiedAt" class="text-xs text-gray-400">· 核验于 {{ formatDate(bomData.verifiedAt) }}</span>
                </div>
                <div class="flex gap-2">
                  <a-button
                    v-if="bomData && bomData.status === 'verified'"
                    size="small"
                    :disabled="bomLoading"
                    @click="handleBomDownload"
                  >
                    导出客户清单
                  </a-button>
                  <a-button
                    v-if="hasBom"
                    :disabled="bomLoading"
                    size="small"
                    type="primary"
                    ghost
                    @click="openVerifyModal"
                  >
                    提交核验
                  </a-button>
                  <a-button
                    size="small"
                    :disabled="bomLoading"
                    :loading="bomImporting"
                    @click="handleBomImport"
                  >
                    导入 XLSX/XLSM
                  </a-button>
                </div>
              </div>

              <!-- 导入预览区 -->
              <div
                v-if="bomImportResult"
                class="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium text-blue-800">导入预览</span>
                  <a-button size="small" @click="bomImportResult = null">
                    取消
                  </a-button>
                </div>
                <div class="text-sm text-gray-600 space-y-1">
                  <div>文件：{{ bomImportResult.sourceFileName }}</div>
                  <div>基础修订：{{ bomImportResult.baseRevision }}</div>
                  <div>
                    可提交：{{ bomImportResult.canCommit ? '是' : '否' }}
                  </div>
                </div>
                <a-input
                  v-model:value="bomChangeReason"
                  placeholder="填写导入变更原因（必填）"
                />
                <!-- 错误列表 -->
                <div v-if="bomImportResult.errors.length > 0" class="space-y-1">
                  <div class="text-sm font-medium text-red-700">
                    错误（{{ bomImportResult.errors.length }} 条）
                  </div>
                  <div
                    v-for="(err, i) in bomImportResult.errors"
                    :key="i"
                    class="text-xs text-red-600 bg-red-50 rounded px-2 py-1"
                  >
                    [{{ err.code }}] {{ err.message }}
                    <span v-if="err.sheet"> · {{ err.sheet }}</span>
                    <span v-if="err.row"> 行{{ err.row }}</span>
                  </div>
                </div>
                <!-- 警告列表 -->
                <div
                  v-if="bomImportResult.warnings.length > 0"
                  class="space-y-1"
                >
                  <div class="text-sm font-medium text-amber-700">
                    警告（{{ bomImportResult.warnings.length }} 条）
                  </div>
                  <div
                    v-for="(warn, i) in bomImportResult.warnings"
                    :key="i"
                    class="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1"
                  >
                    [{{ warn.code }}] {{ warn.message }}
                  </div>
                  <div v-for="code in warningCodes" :key="code" class="mt-1">
                    <a-checkbox
                      :checked="warningConfirmations.includes(code)"
                      @change="
                        (event: { target: { checked: boolean } }) => {
                          warningConfirmations = event.target.checked
                            ? [...warningConfirmations, code]
                            : warningConfirmations.filter(
                                (value) => value !== code,
                              );
                        }
                      "
                    >
                      我已核对并确认 {{ code }}（{{
                        bomImportResult.warnings.filter(
                          (warn) => warn.code === code,
                        ).length
                      }}
                      条）
                    </a-checkbox>
                  </div>
                </div>
                <!-- 预览条目 -->
                <div v-if="bomImportResult.items.length > 0">
                  <div class="text-sm font-medium mb-2">
                    预览条目（{{ bomImportResult.items.length }} 行）
                  </div>
                  <a-table
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
                  <a-button
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
                    {{
                      bomImportResult.canCommit
                        ? '确认提交'
                        : '存在错误，无法提交'
                    }}
                  </a-button>
                </div>
              </div>

              <!-- 当前清单条目 -->
              <div v-if="hasBom && bomData && bomData.items.length > 0">
                <div class="text-sm font-medium mb-2 text-gray-700">
                  当前清单（{{ bomData.items.length }} 行）
                </div>
                <a-table
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
              <a-empty
                v-if="!hasBom || bomData?.items.length === 0"
                description="暂无清单数据，请上传 XLSX/XLSM 文件导入"
              />

              <!-- 计量单位规则 -->
              <div v-if="hasBom && bomData && bomData.unitRules.length > 0">
                <a-divider orientation="left">计量单位规则</a-divider>
                <a-table
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
                <a-button :disabled="bomLoading" @click="startItemEdit">
                  维护条目
                </a-button>
                <a-button :disabled="bomLoading" @click="startRuleEdit">
                  维护计量规则
                </a-button>
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
                    <a-button
                      size="small"
                      :disabled="index === 0"
                      @click="moveItem(index, -1)"
                    >
                      ↑
                    </a-button>
                    <a-button
                      size="small"
                      :disabled="index === itemDraft.length - 1"
                      @click="moveItem(index, 1)"
                    >
                      ↓
                    </a-button>
                    <a-input
                      v-model:value="item.productName"
                      placeholder="产品名称"
                    />
                    <a-input
                      v-model:value="item.productModel"
                      placeholder="型号"
                    />
                    <a-input
                      v-model:value="item.specificationMm"
                      placeholder="规格(mm)"
                    />
                    <a-input
                      v-model:value="item.sourceQuantity"
                      placeholder="源数量"
                    />
                    <a-select
                      v-model:value="item.unitRuleId"
                      class="min-w-32"
                      @change="
                        (id: string) => {
                          item.sourceUnit =
                            bomData?.unitRules.find((rule) => rule.id === id)
                              ?.sourceUnit ?? item.sourceUnit;
                        }
                      "
                    >
                      <a-select-option
                        v-for="rule in bomData?.unitRules"
                        :key="rule.id"
                        :value="rule.id"
                      >
                        {{ rule.sourceUnit }} →
                        {{ rule.pricingUnit }}
                      </a-select-option>
                    </a-select>
                    <a-input v-model:value="item.erpCode" placeholder="ERP" />
                    <a-input
                      v-model:value="item.diffNote"
                      placeholder="差异说明"
                    />
                    <a-button
                      danger
                      :disabled="itemDraft.length === 1"
                      @click="itemDraft.splice(index, 1)"
                    >
                      删除
                    </a-button>
                  </div>
                  <a-button @click="addItem">新增条目</a-button>
                </div>
                <div v-if="editingRules" class="space-y-2">
                  <div
                    v-for="(rule, index) in ruleDraft"
                    :key="rule.id"
                    class="flex items-center gap-2"
                  >
                    <a-select
                      v-model:value="rule.measurementKind"
                      class="min-w-24"
                    >
                      <a-select-option value="count">个数</a-select-option><a-select-option value="length">长度</a-select-option><a-select-option value="area"> 面积 </a-select-option>
                    </a-select>
                    <a-input
                      v-model:value="rule.sourceUnit"
                      placeholder="源单位"
                    />
                    <a-input
                      v-model:value="rule.pricingUnit"
                      placeholder="计价单位"
                    />
                    <a-select
                      v-model:value="rule.conversionCode"
                      class="min-w-32"
                    >
                      <a-select-option value="identity">×1</a-select-option><a-select-option value="mm_to_m">mm → m</a-select-option><a-select-option value="mm2_to_m2">
                        mm² → m²
                      </a-select-option>
                    </a-select>
                    <a-button
                      danger
                      :disabled="
                        ruleDraft.length === 1 ||
                        !!bomData?.items.some(
                          (item) => item.unitRuleId === rule.id,
                        )
                      "
                      @click="ruleDraft.splice(index, 1)"
                    >
                      删除
                    </a-button>
                  </div>
                  <p class="text-xs text-gray-500">
                    被条目引用的规则不可删除；更改源单位前请先调整条目。
                  </p>
                  <a-button @click="addRule">新增规则</a-button>
                </div>
                <a-input
                  v-model:value="bomChangeReason"
                  placeholder="填写变更原因（必填）"
                />
                <div class="flex gap-2">
                  <a-button
                    type="primary"
                    :loading="bomSaving"
                    @click="saveBomDraft"
                  >
                    保存
</a-button><a-button
                    @click="
                      editingItems = false;
                      editingRules = false;
                    "
                  >
                    取消
                  </a-button>
                </div>
              </div>
            </div>
          </a-tab-pane>

          <a-tab-pane v-if="!isCreate" key="publish" tab="审核发布">
            <div v-loading="readinessLoading" class="space-y-4">
              <div v-if="!readinessData" class="text-center py-8">
                <a-button :loading="readinessLoading" @click="fetchReadiness">
                  加载就绪状态
                </a-button>
              </div>
              <template v-else>
                <!-- 就绪状态概览 -->
                <div class="rounded-lg border bg-gray-50 px-4 py-3">
                  <div class="flex items-center justify-between mb-3">
                    <span class="font-medium text-gray-700">发布就绪状态</span>
                    <div class="flex items-center gap-2">
                      <a-tag v-if="readinessData.canPublish" color="success">
                        可发布
                      </a-tag>
                      <a-tag v-else color="warning">未就绪</a-tag>
                      <a-button
                        size="small"
                        :loading="readinessLoading"
                        @click="fetchReadiness"
                      >
                        刷新
                      </a-button>
                    </div>
                  </div>
                  <!-- 阻断项 -->
                  <div v-if="readinessData.blockers.length > 0" class="mb-3">
                    <div class="text-sm font-medium text-red-600 mb-1">
                      发布阻断项
                    </div>
                    <div
                      v-for="(blocker, i) in readinessData.blockers"
                      :key="i"
                      class="text-sm text-red-500 bg-red-50 rounded px-2 py-1 mb-1"
                    >
                      {{ blocker }}
                    </div>
                  </div>
                  <!-- 资产汇总 -->
                  <div class="grid grid-cols-3 gap-3">
                    <div class="rounded border bg-white px-3 py-2 text-sm">
                      <div class="text-gray-500 mb-1">效果图</div>
                      <div class="flex items-center gap-2">
                        <span class="font-semibold">{{
                          readinessData.assets.rendering.count
                        }}</span>
                        <a-tag
                          v-if="readinessData.assets.rendering.count >= 3"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </a-tag>
                        <a-tag v-else color="error" class="text-xs">需≥3</a-tag>
                      </div>
                    </div>
                    <div class="rounded border bg-white px-3 py-2 text-sm">
                      <div class="text-gray-500 mb-1">蒙版</div>
                      <div class="flex items-center gap-2">
                        <span class="font-semibold">{{
                          readinessData.assets.mask.count
                        }}</span>
                        <a-tag
                          v-if="readinessData.assets.mask.count >= 3"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </a-tag>
                        <a-tag v-else color="error" class="text-xs">需≥3</a-tag>
                      </div>
                    </div>
                    <div class="rounded border bg-white px-3 py-2 text-sm">
                      <div class="text-gray-500 mb-1">模型</div>
                      <div class="flex items-center gap-2">
                        <span class="font-semibold">{{
                          readinessData.assets.model.count
                        }}</span>
                        <a-tag
                          v-if="readinessData.assets.model.count > 0"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </a-tag>
                        <a-tag v-else color="error" class="text-xs">缺失</a-tag>
                      </div>
                    </div>
                    <div class="rounded border bg-white px-3 py-2 text-sm">
                      <div class="text-gray-500 mb-1">报馆图</div>
                      <span class="font-semibold">{{
                        readinessData.assets.drawing.count
                      }}</span>
                    </div>
                    <div class="rounded border bg-white px-3 py-2 text-sm">
                      <div class="text-gray-500 mb-1">平面素材</div>
                      <span class="font-semibold">{{
                        readinessData.assets.artwork.count
                      }}</span>
                    </div>
                    <div class="rounded border bg-white px-3 py-2 text-sm">
                      <div class="text-gray-500 mb-1">清单核验</div>
                      <a-tag
                        v-if="readinessData.assets.checklist.verified"
                        color="success"
                        class="text-xs"
                      >
                        已核验
                      </a-tag>
                      <a-tag v-else color="warning" class="text-xs">
                        未核验
                      </a-tag>
                    </div>
                  </div>
                </div>

                <!-- 操作区 -->
                <div class="flex gap-3">
                  <a-button type="primary" ghost @click="openReviewModal">
                    整体审核
                  </a-button>
                  <a-button
                    type="primary"
                    :loading="publishLoading"
                    :disabled="!readinessData.canPublish"
                    @click="handlePublish"
                  >
                    发布方案
                  </a-button>
                  <a-button
                    v-if="originalData?.publishStatus === 'published'"
                    danger
                    @click="openUnpublishModal"
                  >
                    下架方案
                  </a-button>
                </div>
              </template>
            </div>
          </a-tab-pane>
        </a-tabs>
      </a-form>
    </div>

    <!-- 核验弹窗 -->
    <a-modal
      v-model:open="verifyModalVisible"
      title="提交清单核验"
      :confirm-loading="verifySubmitting"
      @ok="handleVerifySubmit"
      ok-text="提交"
      cancel-text="取消"
    >
      <div class="space-y-4">
        <a-form layout="vertical">
          <a-form-item label="核验结论">
            <a-radio-group v-model:value="verifyForm.decision">
              <a-radio value="pass">通过</a-radio>
              <a-radio value="reject">不通过</a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item label="逐项确认（通过时全部需勾选）">
            <div class="space-y-2">
              <a-checkbox v-model:checked="verifyForm.sourceExtraction">
                提取一致性：源行与提取行对应，数值与ERP保真
              </a-checkbox>
              <a-checkbox v-model:checked="verifyForm.modelCrossCheck">
                模型逐项核对：型号、规格、数量与SKP一致
              </a-checkbox>
              <a-checkbox v-model:checked="verifyForm.supportingParts">
                配套项确认：连接件、支撑件及配套项已检查
              </a-checkbox>
              <a-checkbox v-model:checked="verifyForm.unitConsistency">
                单位一致性：个数/长度/面积口径与SU一致
              </a-checkbox>
            </div>
          </a-form-item>

          <a-form-item label="绑定模型资产（通过时必填）">
            <a-select
              v-model:value="verifyForm.modelAssetId"
              placeholder="选择模型文件"
              class="w-full"
            >
              <a-select-option
                v-for="asset in modelAssets.filter(
                  (asset) => asset.isActive && asset.currentVersion,
                )"
                :key="asset.id"
                :value="asset.id"
              >
                {{ asset.name }} ·
                {{ asset.currentVersion?.originalFilename }}
              </a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="核验意见">
            <a-textarea
              v-model:value="verifyForm.notes"
              :rows="3"
              placeholder="不通过时请填写具体问题"
            />
          </a-form-item>
        </a-form>
      </div>
    </a-modal>
    <!-- 整体审核弹窗 -->
    <a-modal
      v-model:open="reviewModalVisible"
      title="整体审核"
      :confirm-loading="reviewSubmitting"
      @ok="handleReviewSubmit"
      ok-text="提交"
      cancel-text="取消"
    >
      <div class="space-y-4">
        <a-form layout="vertical">
          <a-form-item label="审核阶段">
            <a-radio-group v-model:value="reviewForm.phase">
              <a-radio value="overall">整体审核</a-radio>
              <a-radio value="asset_verification">资产核验</a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item label="审核结论">
            <a-radio-group v-model:value="reviewForm.decision">
              <a-radio value="pass">通过</a-radio>
              <a-radio value="reject">不通过</a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item label="确认项（通过时建议全选）">
            <div class="space-y-2">
              <a-checkbox v-model:checked="reviewForm.checks.assetsComplete">
                六类资产完整：效果图≥3、蒙版≥3、模型已上传
              </a-checkbox>
              <a-checkbox v-model:checked="reviewForm.checks.bomVerified">
                清单已核验：条目与模型逐项对应
              </a-checkbox>
              <a-checkbox
                v-model:checked="reviewForm.checks.renderingsAndMasks"
              >
                效果图与蒙版一一配对、尺寸一致
              </a-checkbox>
              <a-checkbox v-model:checked="reviewForm.checks.drawingsComplete">
                报馆图覆盖必需视向
              </a-checkbox>
            </div>
          </a-form-item>

          <a-form-item label="审核意见">
            <a-textarea
              v-model:value="reviewForm.notes"
              :rows="3"
              placeholder="不通过时请填写具体问题"
            />
          </a-form-item>
        </a-form>
      </div>
    </a-modal>

    <!-- 下架弹窗 -->
    <a-modal
      v-model:open="unpublishModalVisible"
      title="下架方案"
      :confirm-loading="unpublishSubmitting"
      @ok="handleUnpublishSubmit"
      ok-text="确认下架"
      cancel-text="取消"
      ok-type="danger"
    >
      <div class="space-y-3">
        <p class="text-gray-600">
          下架后，客户端将无法匹配和使用该方案。历史项目引用不受影响。
        </p>
        <a-form layout="vertical">
          <a-form-item label="下架原因（可选）">
            <a-textarea
              v-model:value="unpublishReason"
              :rows="3"
              placeholder="请填写下架原因"
            />
          </a-form-item>
        </a-form>
      </div>
    </a-modal>
  </div>
</template>
