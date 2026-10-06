<script setup lang="ts">
import type { SchemeAsset } from '#/api/core/assets';
import type { BomRecord } from '#/api/core/bom';
import type { ReadinessResult } from '#/api/core/reviews';
import type {
  CreateSchemeInput,
  SchemeRecord,
  UpdateSchemeInput,
} from '#/api/core/schemes';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { cloneDeep, formatDate, isEqual } from '@vben/utils';

import {
  Button as AButton,
  Card as ACard,
  Checkbox as ACheckbox,
  Divider as ADivider,
  Empty as AEmpty,
  Form as AForm,
  Input as AInput,
  InputNumber as AInputNumber,
  Modal as AModal,
  Radio as ARadio,
  Select as ASelect,
  Tabs as ATabs,
  Tag as ATag,
  Tooltip as ATooltip,
  message,
} from 'ant-design-vue';

import {
  getAssetDownloadUrlApi,
  listSchemeAssetsApi,
  uploadAssetApi,
} from '#/api/core/assets';
import { getBomApi } from '#/api/core/bom';
import {
  createSchemeReviewApi,
  getSchemeReadinessApi,
  publishSchemeApi,
  unpublishSchemeApi,
} from '#/api/core/reviews';
import {
  createSchemeApi,
  getSchemeDetailApi,
  getSchemeOptionsApi,
  updateSchemeApi,
} from '#/api/core/schemes';

const AFormItem = AForm.Item;
const ARadioGroup = ARadio.Group;
const ATabPane = ATabs.TabPane;
const ATextarea = AInput.TextArea;

const route = useRoute();
const router = useRouter();
const { hasAccessByCodes } = useAccess();

const isCreate = computed(() => route.path === '/scheme/create');
const currentCode = computed(() =>
  route.params.code ? decodeURIComponent(route.params.code as string) : '',
);

const isPublished = computed(
  () => originalData.value?.publishStatus === 'published',
);
/** 内容阻断项未清空，不能提交整体审核通过 */
const reviewBlocked = computed(
  () => (readinessData.value?.coreBlockers.length ?? 0) > 0,
);
/** 内容已就绪，仅缺当前修订的整体审核通过记录 */
const awaitingReview = computed(() => {
  const readiness = readinessData.value;
  return (
    !!readiness &&
    !reviewBlocked.value &&
    readiness.blockers.length > readiness.coreBlockers.length
  );
});
const readinessTag = computed(() => {
  const readiness = readinessData.value;
  if (!readiness) return null;
  if (isPublished.value) {
    return readiness.canSelect
      ? { color: 'success', text: '在线可匹配' }
      : { color: 'error', text: `${readiness.blockers.length} 项异常` };
  }
  if (readiness.canPublish) return { color: 'success', text: '可发布' };
  if (awaitingReview.value) return { color: 'processing', text: '待整体审核' };
  return {
    color: 'warning',
    text: `${readiness.coreBlockers.length} 项未就绪`,
  };
});

const loading = ref(false);
const saving = ref(false);
const activeTab = ref('basic');

const formRef = ref();

const formData = reactive<CreateSchemeInput & { editRevision?: number }>({
  code: '',
  name: '',
  parentCode: undefined,
  description: undefined,
  lengthMm: undefined,
  widthMm: undefined,
  heightMm: undefined,
  areaM2: undefined,
  openingCount: undefined,
  productSystemId: undefined,
  styleId: undefined,
  industryIds: [],
  budgetTierId: undefined,
  keywords: [],
  notes: undefined,
  zoneIds: [],
  featureIds: [],
  source: undefined,
});

const originalData = ref<null | SchemeRecord>(null);

// 面积由长宽推导，不单独参与变更判断
type EditableKey = Exclude<keyof UpdateSchemeInput, 'areaM2' | 'editRevision'>;
const editableKeys = [
  'name',
  'parentCode',
  'description',
  'lengthMm',
  'widthMm',
  'heightMm',
  'openingCount',
  'productSystemId',
  'styleId',
  'industryIds',
  'budgetTierId',
  'keywords',
  'notes',
  'zoneIds',
  'featureIds',
  'source',
] as const satisfies readonly EditableKey[];

/** 空字符串、空数组与未填写视为同一值，避免回填差异被误判为修改 */
function comparable(value: unknown): unknown {
  if (
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  return value;
}

const arrayKeys = new Set<string>([
  'featureIds',
  'industryIds',
  'keywords',
  'zoneIds',
]);

const savedSnapshot = ref<Partial<Record<EditableKey, unknown>>>({});

function takeSnapshot() {
  savedSnapshot.value = Object.fromEntries(
    editableKeys.map((key) => [key, cloneDeep(comparable(formData[key]))]),
  );
}

const changedKeys = computed(() =>
  editableKeys.filter(
    (key) => !isEqual(comparable(formData[key]), savedSnapshot.value[key]),
  ),
);
const isDirty = computed(() => changedKeys.value.length > 0);

const modelAssets = ref<SchemeAsset[]>([]);
const modelUploading = ref(false);
const checklistBom = ref<BomRecord | null>(null);
const checklistLoading = ref(false);
let checklistRequestSequence = 0;

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
  productSystems: [] as { label: string; value: string }[],
  budgetTiers: [] as { label: string; value: string }[],
  zones: [] as { label: string; value: string }[],
  features: [] as { label: string; value: string }[],
});

async function fetchOptions() {
  try {
    const res = await getSchemeOptionsApi();
    if (res) {
      if (res.style)
        options.styles = res.style.map((o) => ({
          label: o.label,
          value: o.id,
        }));
      if (res.industry)
        options.industries = res.industry.map((o) => ({
          label: o.label,
          value: o.id,
        }));
      if (res.product_system)
        options.productSystems = res.product_system.map((o) => ({
          label: o.label,
          value: o.id,
        }));
      if (res.budget_tier)
        options.budgetTiers = res.budget_tier.map((o) => ({
          label: o.label,
          value: o.id,
        }));
      options.zones = (res.functional_zone || []).map((o) => ({
        label: o.label,
        value: o.id,
      }));
      options.features = (res.key_feature || []).map((o) => ({
        label: o.label,
        value: o.id,
      }));
    }
  } catch (error) {
    console.error('Failed to load catalog options:', error);
  }
}

/**
 * @param preserveEdits 仅刷新状态与修订号，保留表单中尚未保存的修改（如上传资产后）
 */
async function fetchDetail(preserveEdits = false) {
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
    const assets = hasAccessByCodes([
      'assets-renderings.read',
      'assets-masks.read',
      'assets-drawings.read',
      'assets-artworks.read',
      'assets-models.read',
      'assets-checklists.read',
    ])
      ? await listSchemeAssetsApi(requestCode)
      : [];
    if (sequence !== detailRequestSequence || requestCode !== currentCode.value)
      return;
    assetCounts.rendering = assets.filter((a) => a.type === 'rendering').length;
    assetCounts.mask = assets.filter((a) => a.type === 'mask').length;
    assetCounts.drawing = assets.filter((a) => a.type === 'drawing').length;
    assetCounts.artwork = assets.filter((a) => a.type === 'artwork').length;
    assetCounts.model = assets.filter((a) => a.type === 'model').length;
    assetCounts.checklist = assets.filter((a) => a.type === 'checklist').length;
    modelAssets.value = assets.filter((a) => a.type === 'model');

    formData.editRevision = res.editRevision;
    if (preserveEdits && isDirty.value) return;
    // 整体回填（含空值），避免切换方案时残留上一个方案的字段
    const fields = formData as Record<string, unknown>;
    for (const key of Object.keys(formData)) {
      if (key === 'editRevision') continue;
      const value = res[key as keyof SchemeRecord];
      if (value === null || value === undefined) {
        fields[key] = arrayKeys.has(key) ? [] : undefined;
      } else {
        fields[key] = key === 'areaM2' ? Number(value) : value;
      }
    }
    takeSnapshot();
  } catch (error: any) {
    message.error(error.message || '获取方案详情失败');
  } finally {
    if (sequence === detailRequestSequence) loading.value = false;
  }
}

async function fetchChecklistBom() {
  if (!currentCode.value || !hasAccessByCodes(['bom.read'])) return;
  const requestCode = currentCode.value;
  const sequence = ++checklistRequestSequence;
  checklistLoading.value = true;
  try {
    const result = await getBomApi(requestCode);
    if (
      sequence === checklistRequestSequence &&
      requestCode === currentCode.value
    ) {
      checklistBom.value = result;
    }
  } catch (error: any) {
    if (
      sequence === checklistRequestSequence &&
      requestCode === currentCode.value
    ) {
      checklistBom.value = null;
      message.error(error?.message || '获取简化清单失败');
    }
  } finally {
    if (sequence === checklistRequestSequence) checklistLoading.value = false;
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
      // 资产变更会使已发布方案下线、审核失效，需同步状态
      await Promise.all([fetchDetail(true), fetchReadiness()]);
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
  if (formData.lengthMm && formData.widthMm) {
    formData.areaM2 = Number(
      ((formData.lengthMm * formData.widthMm) / 1_000_000).toFixed(6),
    );
  } else formData.areaM2 = null;
}

async function handleSave() {
  try {
    await formRef.value.validate();
  } catch {
    message.warning('请检查表单填写');
    return;
  }

  if (!isCreate.value) {
    const changed = changedKeys.value;
    if (changed.length === 0) {
      message.info('没有需要保存的修改');
      return;
    }
    const notesOnly = changed.every((key) => key === 'notes');
    if (isPublished.value && !notesOnly) {
      const confirmed = await new Promise<boolean>((resolve) => {
        AModal.confirm({
          title: '保存后方案将下线',
          content:
            '已发布方案修改业务内容后会自动下线，需要重新整体审核并发布。仅修改备注不受影响。',
          okText: '保存并下线',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
  }

  saving.value = true;
  try {
    if (isCreate.value) {
      const res = await createSchemeApi({ ...formData });
      message.success('创建成功');
      router.replace(`/scheme/detail/${encodeURIComponent(res.code)}`);
    } else if (originalData.value) {
      // 只提交实际修改的字段，避免无变更保存递增修订
      const payload: UpdateSchemeInput = {
        ...Object.fromEntries(
          changedKeys.value.map((key) => {
            const value = formData[key];
            return [
              key,
              Array.isArray(value) ? value : (comparable(value) ?? null),
            ];
          }),
        ),
        editRevision: originalData.value.editRevision,
      };
      if (
        changedKeys.value.some((key) => key === 'lengthMm' || key === 'widthMm')
      )
        payload.areaM2 = formData.areaM2 ?? null;
      await updateSchemeApi(currentCode.value, payload);
      message.success('保存成功');
      await refreshStatus();
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
  if (!hasAccessByCodes(['schemes.readiness'])) return;
  if (!currentCode.value) return;
  const requestCode = currentCode.value;
  const sequence = ++readinessRequestSequence;
  readinessLoading.value = true;
  try {
    const result = await getSchemeReadinessApi(requestCode);
    if (
      sequence === readinessRequestSequence &&
      requestCode === currentCode.value
    )
      readinessData.value = result;
  } catch (error: any) {
    if (sequence === readinessRequestSequence)
      message.error(error?.message || '获取就绪状态失败');
  } finally {
    if (sequence === readinessRequestSequence) readinessLoading.value = false;
  }
}

/** 审核、发布、下架后方案状态与就绪结果均会变化 */
async function refreshStatus() {
  await Promise.all([fetchDetail(), fetchReadiness()]);
}

function openReviewModal() {
  reviewRequestKey.value = crypto.randomUUID();
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
      schemeRevision: originalData.value.editRevision,
      phase: 'overall',
      decision: reviewForm.decision,
      checks: { ...reviewForm.checks },
      notes: reviewForm.notes.trim() || null,
    });
    message.success(
      reviewForm.decision === 'pass' ? '审核通过，可发布方案' : '审核不通过已记录',
    );
    reviewModalVisible.value = false;
    await refreshStatus();
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
    await refreshStatus();
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
    await refreshStatus();
  } catch (error: any) {
    message.error(error?.message || '下架失败');
  } finally {
    unpublishSubmitting.value = false;
  }
}

let detailRequestSequence = 0;
let readinessRequestSequence = 0;
// 就绪检查
const readinessLoading = ref(false);
const readinessData = ref<null | ReadinessResult>(null);

// 整体审核弹窗（阶段固定为 overall，确认项为审核人对人工判断部分的确认）
const reviewModalVisible = ref(false);
const reviewSubmitting = ref(false);
const reviewRequestKey = ref('');
const reviewForm = reactive({
  decision: 'pass' as 'pass' | 'reject',
  checks: {
    assetsComplete: false,
    bomVerified: false,
    renderingsAndMasks: false,
    drawingsComplete: false,
  },
  notes: '',
});
const reviewSubmitDisabled = computed(() =>
  reviewForm.decision === 'pass'
    ? reviewBlocked.value || !Object.values(reviewForm.checks).every(Boolean)
    : !reviewForm.notes.trim(),
);

// 下架弹窗
const unpublishModalVisible = ref(false);
const unpublishSubmitting = ref(false);
const unpublishReason = ref('');

// 发布 loading
const publishLoading = ref(false);

watch(currentCode, () => {
  detailRequestSequence++;
  checklistRequestSequence++;
  readinessRequestSequence++;
  originalData.value = null;
  checklistBom.value = null;
  readinessData.value = null;
  if (currentCode.value) refreshStatus();
});

watch(activeTab, (tab) => {
  if (tab === 'checklist' && currentCode.value && !checklistBom.value) {
    fetchChecklistBom();
  }
});

onMounted(() => {
  fetchOptions();
  refreshStatus();
});
</script>

<template>
  <div class="space-y-4 p-4" v-loading="loading">
    <div
      class="bg-background border-border flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 shadow-sm"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <AButton
          type="link"
          @click="handleBack"
          class="p-0 flex items-center gap-1"
        >
          <span class="icon-[lucide--arrow-left]"></span>
          返回
        </AButton>
        <h2 class="m-0 break-all text-xl font-semibold">
          {{ isCreate ? '新建方案' : `方案详情: ${currentCode}` }}
        </h2>

        <div
          v-if="!isCreate && originalData"
          class="flex flex-wrap items-center gap-2"
        >
          <ATag v-if="isPublished" color="green">已发布</ATag>
          <ATag
            v-else-if="originalData.publishStatus === 'unpublished'"
            color="orange"
          >
            已下架
          </ATag>
          <ATag v-else>草稿</ATag>

          <ATag
            v-if="readinessTag"
            :color="readinessTag.color"
            class="cursor-pointer"
            @click="activeTab = 'publish'"
          >
            {{ readinessTag.text }}
          </ATag>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="isCreate">
          <AButton
            type="primary"
            :loading="saving"
            @click="handleSave"
            v-access:code="['schemes.create']"
          >
            创建方案
          </AButton>
        </template>
        <template v-else-if="originalData">
          <AButton
            :disabled="!isDirty"
            :loading="saving"
            @click="handleSave"
            v-access:code="['schemes.update']"
          >
            保存
          </AButton>

          <AButton
            v-if="isPublished"
            danger
            @click="openUnpublishModal"
            v-access:code="['schemes.unpublish']"
          >
            下架
          </AButton>
          <!-- 未发布：按就绪状态只给出下一步操作；无就绪权限时两者都显示，由服务端校验 -->
          <template v-else>
            <ATooltip
              v-if="!readinessData?.canPublish"
              :title="
                isDirty
                  ? '有未保存的修改，请先保存'
                  : reviewBlocked
                    ? '存在未就绪项，请先在「审核发布」中处理'
                    : undefined
              "
            >
              <AButton
                :type="readinessData ? 'primary' : 'default'"
                :disabled="isDirty || reviewBlocked"
                @click="openReviewModal"
                v-access:code="['schemes.review']"
              >
                整体审核
              </AButton>
            </ATooltip>
            <ATooltip
              v-if="!readinessData || readinessData.canPublish"
              :title="isDirty ? '有未保存的修改，请先保存' : undefined"
            >
              <AButton
                type="primary"
                :disabled="isDirty"
                :loading="publishLoading"
                @click="handlePublish"
                v-access:code="['schemes.publish']"
              >
                发布
              </AButton>
            </ATooltip>
          </template>
        </template>
      </div>
    </div>

    <div class="bg-background border-border rounded-lg border p-4 shadow-sm">
      <AForm ref="formRef" :model="formData" layout="vertical">
        <ATabs v-model:active-key="activeTab" class="min-w-0">
          <ATabPane key="basic" tab="基础信息">
            <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              <AFormItem
                label="方案编号"
                name="code"
                :rules="[{ required: true, message: '请输入方案编号' }]"
              >
                <AInput
                  v-model:value="formData.code"
                  :disabled="!isCreate"
                  placeholder="如: SCH-001"
                />
              </AFormItem>

              <AFormItem
                label="方案名称"
                name="name"
                :rules="[{ required: true, message: '请输入方案名称' }]"
              >
                <AInput
                  v-model:value="formData.name"
                  placeholder="请输入方案名称"
                />
              </AFormItem>

              <AFormItem label="来源" name="source">
                <AInput
                  :value="formData.source ?? undefined"
                  @update:value="formData.source = $event"
                  placeholder="请输入来源"
                />
              </AFormItem>

              <AFormItem label="母方案编号" name="parentCode">
                <AInput
                  :value="formData.parentCode ?? undefined"
                  @update:value="formData.parentCode = $event"
                  placeholder="可选填已有方案编号"
                />
              </AFormItem>
            </div>

            <AFormItem label="一句话描述" name="description">
              <ATextarea
                :value="formData.description ?? undefined"
                @update:value="formData.description = $event"
                :rows="3"
                placeholder="请输入描述"
              />
            </AFormItem>

            <AFormItem label="备注" name="notes">
              <ATextarea
                :value="formData.notes ?? undefined"
                @update:value="formData.notes = $event"
                :rows="3"
                placeholder="请输入备注"
              />
            </AFormItem>

            <ADivider orientation="left">空间信息</ADivider>
            <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
              <AFormItem label="长 (mm)" name="lengthMm">
                <AInputNumber
                  :value="formData.lengthMm ?? undefined"
                  @update:value="
                    formData.lengthMm =
                      typeof $event === 'number' ? $event : null
                  "
                  @change="calculateArea"
                  class="w-full"
                  :min="1"
                  :precision="0"
                />
              </AFormItem>

              <AFormItem label="宽 (mm)" name="widthMm">
                <AInputNumber
                  :value="formData.widthMm ?? undefined"
                  @update:value="
                    formData.widthMm =
                      typeof $event === 'number' ? $event : null
                  "
                  @change="calculateArea"
                  class="w-full"
                  :min="1"
                  :precision="0"
                />
              </AFormItem>

              <AFormItem label="高 (mm)" name="heightMm">
                <AInputNumber
                  :value="formData.heightMm ?? undefined"
                  @update:value="
                    formData.heightMm =
                      typeof $event === 'number' ? $event : null
                  "
                  class="w-full"
                  :min="1"
                  :precision="0"
                />
              </AFormItem>

              <AFormItem label="面积 (m²)" name="areaM2">
                <AInputNumber
                  :value="formData.areaM2 ?? undefined"
                  class="w-full"
                  :min="0"
                  disabled
                />
              </AFormItem>
            </div>
          </ATabPane>

          <ATabPane key="tags" tab="打标">
            <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              <AFormItem label="产品体系" name="productSystemId">
                <ASelect
                  :value="formData.productSystemId ?? undefined"
                  @update:value="
                    formData.productSystemId =
                      typeof $event === 'string' ? $event : null
                  "
                  :options="options.productSystems"
                  placeholder="请选择"
                  allow-clear
                />
              </AFormItem>

              <AFormItem label="风格" name="styleId">
                <ASelect
                  :value="formData.styleId ?? undefined"
                  @update:value="
                    formData.styleId =
                      typeof $event === 'string' ? $event : null
                  "
                  :options="options.styles"
                  placeholder="请选择"
                  allow-clear
                />
              </AFormItem>

              <AFormItem label="适用行业" name="industryIds">
                <ASelect
                  v-model:value="formData.industryIds"
                  :options="options.industries"
                  mode="multiple"
                  placeholder="请选择"
                  allow-clear
                />
              </AFormItem>

              <AFormItem label="预算档位" name="budgetTierId">
                <ASelect
                  :value="formData.budgetTierId ?? undefined"
                  @update:value="
                    formData.budgetTierId =
                      typeof $event === 'string' ? $event : null
                  "
                  :options="options.budgetTiers"
                  placeholder="请选择"
                  allow-clear
                />
              </AFormItem>

              <AFormItem label="开口面数" name="openingCount">
                <AInputNumber
                  :value="formData.openingCount ?? undefined"
                  @update:value="
                    formData.openingCount =
                      typeof $event === 'number' ? $event : null
                  "
                  class="w-full"
                  :min="0"
                  :max="4"
                />
              </AFormItem>

              <AFormItem label="功能分区" name="zoneIds">
                <ASelect
                  v-model:value="formData.zoneIds"
                  :options="options.zones"
                  mode="multiple"
                  placeholder="请选择"
                />
              </AFormItem>

              <AFormItem label="关键特征" name="featureIds">
                <ASelect
                  v-model:value="formData.featureIds"
                  :options="options.features"
                  mode="multiple"
                  placeholder="请选择"
                />
              </AFormItem>

              <AFormItem label="关键词" name="keywords" class="sm:col-span-2">
                <ASelect
                  v-model:value="formData.keywords"
                  mode="tags"
                  placeholder="输入并回车添加关键词"
                />
              </AFormItem>
            </div>
</ATabPane>

          <ATabPane
            v-if="!isCreate && hasAccessByCodes(['assets-models.read'])"
            key="model"
            tab="模型"
          >
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <span class="text-muted-foreground text-sm">共 {{ modelAssets.length }} 个模型文件</span>
              <AButton
                type="primary"
                :loading="modelUploading"
                @click="handleModelUpload"
                v-access:code="['assets-models.upload']"
              >
                上传模型（.skp）
              </AButton>
            </div>
            <AEmpty
              v-if="modelAssets.length === 0"
              description="暂无模型文件"
            />
            <div v-else class="space-y-3">
              <div
                v-for="asset in modelAssets"
                :key="asset.id"
                class="border-border bg-muted/50 flex items-center justify-between gap-3 rounded border px-4 py-3"
              >
                <div>
                  <div class="font-medium">{{ asset.name }}</div>
                  <div class="text-muted-foreground mt-1 text-xs">
                    {{ asset.currentVersion?.originalFilename || '未上传文件' }}
                    · {{ formatDate(asset.createdAt) }}
                  </div>
                </div>
                <AButton
                  v-if="asset.currentVersion"
                  type="link"
                  size="small"
                  @click="handleModelDownload(asset)"
                  v-access:code="['assets-models.download']"
                >
                  下载
                </AButton>
              </div>
            </div>
          </ATabPane>

          <ATabPane
            v-if="
              !isCreate &&
              hasAccessByCodes([
                'assets-renderings.read',
                'assets-masks.read',
                'assets-drawings.read',
                'assets-artworks.read',
                'assets-models.read',
                'assets-checklists.read',
              ])
            "
            key="assets"
            tab="资产汇总"
          >
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <ACard
                v-if="hasAccessByCodes(['assets-renderings.read'])"
                hoverable
                class="text-center"
                @click="
                  router.push(`/assets/renderings?schemeCode=${currentCode}`)
                "
              >
                <div class="text-muted-foreground mb-2">效果图</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.rendering }}
                </div>
              </ACard>
              <ACard
                v-if="hasAccessByCodes(['assets-masks.read'])"
                hoverable
                class="text-center"
                @click="router.push(`/assets/masks?schemeCode=${currentCode}`)"
              >
                <div class="text-muted-foreground mb-2">蒙版</div>
                <div class="text-2xl font-semibold">{{ assetCounts.mask }}</div>
              </ACard>
              <ACard
                v-if="hasAccessByCodes(['assets-drawings.read'])"
                hoverable
                class="text-center"
                @click="
                  router.push(
                    `/assets/venue-materials?schemeCode=${currentCode}`,
                  )
                "
              >
                <div class="text-muted-foreground mb-2">报馆图</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.drawing }}
                </div>
              </ACard>
              <ACard
                v-if="hasAccessByCodes(['assets-artworks.read'])"
                hoverable
                class="text-center"
                @click="
                  router.push(`/assets/artworks?schemeCode=${currentCode}`)
                "
              >
                <div class="text-muted-foreground mb-2">平面素材</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.artwork }}
                </div>
              </ACard>
              <ACard
                v-if="hasAccessByCodes(['assets-models.read'])"
                class="text-center"
              >
                <div class="text-muted-foreground mb-2">模型</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.model }}
                </div>
              </ACard>
              <ACard
                v-if="hasAccessByCodes(['assets-checklists.read'])"
                class="text-center"
              >
                <div class="text-muted-foreground mb-2">清单</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.checklist }}
                </div>
              </ACard>
            </div>
          </ATabPane>

          <ATabPane
            v-if="!isCreate && hasAccessByCodes(['bom.read'])"
            key="checklist"
            tab="简化清单"
          >
            <div v-loading="checklistLoading" class="space-y-4 py-4">
              <div
                class="border-border bg-muted/50 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
              >
                <div>
                  <div class="font-medium">已关联当前方案的简化清单</div>
                  <div class="text-muted-foreground mt-1 text-sm">
                    清单数据按方案编号
                    {{ currentCode }}
                    关联，可在清单管理中继续导入、维护、核验和导出。
                  </div>
                </div>
                <AButton
                  type="primary"
                  @click="
                    router.push({
                      path: '/bill-of-materials',
                      query: { code: currentCode },
                    })
                  "
                >
                  进入清单管理
                </AButton>
              </div>

              <div
                v-if="checklistBom && checklistBom.status !== 'absent'"
                class="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                <div class="border-border rounded border p-3">
                  <div class="text-muted-foreground text-xs">关联状态</div>
                  <ATag
                    class="mt-2"
                    :color="
                      checklistBom.status === 'verified'
                        ? 'success'
                        : checklistBom.status === 'rejected'
                          ? 'error'
                          : 'warning'
                    "
                  >
                    {{
                      checklistBom.status === 'verified'
                        ? '已核验'
                        : checklistBom.status === 'rejected'
                          ? '核验不通过'
                          : '待核验'
                    }}
                  </ATag>
                </div>
                <div class="border-border rounded border p-3">
                  <div class="text-muted-foreground text-xs">当前修订</div>
                  <div class="mt-2 font-semibold">
                    {{ checklistBom.revision }}
                  </div>
                </div>
                <div class="border-border rounded border p-3">
                  <div class="text-muted-foreground text-xs">清单条目</div>
                  <div class="mt-2 font-semibold">
                    {{ checklistBom.items.length }} 条
                  </div>
                </div>
              </div>

              <AEmpty
                v-else-if="!checklistLoading"
                description="当前方案尚未关联简化清单"
              />
            </div>
          </ATabPane>

          <ATabPane
            v-if="!isCreate && hasAccessByCodes(['schemes.readiness'])"
            key="publish"
            tab="审核发布"
          >
            <div v-loading="readinessLoading" class="space-y-4">
              <div v-if="!readinessData" class="py-8 text-center">
                <AButton :loading="readinessLoading" @click="fetchReadiness">
                  加载就绪状态
                </AButton>
              </div>
              <template v-else>
                <!-- 就绪状态概览 -->
                <div class="border-border bg-muted/50 rounded-lg border p-4">
                  <div
                    class="mb-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <span class="font-semibold">发布就绪状态</span>
                    <div class="flex flex-wrap items-center gap-2">
                      <ATag v-if="readinessTag" :color="readinessTag.color">
                        {{ readinessTag.text }}
                      </ATag>
                      <AButton
                        size="small"
                        :loading="readinessLoading"
                        @click="fetchReadiness"
                      >
                        刷新
                      </AButton>
                    </div>
                  </div>
                  <!-- 阻断项：未发布时只列内容项，审核状态单独提示 -->
                  <div
                    v-if="
                      (isPublished
                        ? readinessData.blockers
                        : readinessData.coreBlockers
                      ).length > 0
                    "
                    class="mb-4"
                  >
                    <div class="text-destructive mb-2 text-sm font-medium">
                      {{ isPublished ? '上线异常项' : '未就绪项' }}
                    </div>
                    <div
                      v-for="(blocker, i) in isPublished
                        ? readinessData.blockers
                        : readinessData.coreBlockers"
                      :key="i"
                      class="text-destructive bg-destructive/10 mb-1 rounded px-3 py-2 text-sm"
                    >
                      {{ blocker }}
                    </div>
                  </div>
                  <div
                    v-else-if="awaitingReview"
                    class="text-primary bg-primary/10 mb-4 rounded px-3 py-2 text-sm"
                  >
                    内容已就绪，请点击页面顶部「整体审核」完成人工审核。
                  </div>
                  <!-- 资产汇总 -->
                  <div
                    class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    <div
                      class="border-border bg-background rounded border p-3 text-sm"
                    >
                      <div class="text-muted-foreground mb-2">效果图</div>
                      <div class="flex items-center gap-2">
                        <span class="font-semibold">{{
                          readinessData.assets.rendering.count
                        }}</span>
                        <ATag
                          v-if="readinessData.assets.rendering.count === 3"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </ATag>
                        <ATag v-else color="error" class="text-xs">需 3 张</ATag>
                      </div>
                    </div>
                    <div
                      class="border-border bg-background rounded border p-3 text-sm"
                    >
                      <div class="text-muted-foreground mb-2">蒙版</div>
                      <div class="flex items-center gap-2">
                        <span class="font-semibold">{{
                          readinessData.assets.mask.count
                        }}</span>
                        <ATag
                          v-if="readinessData.assets.mask.count === 3"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </ATag>
                        <ATag v-else color="error" class="text-xs">需 3 张</ATag>
                      </div>
                    </div>
                    <div
                      class="border-border bg-background rounded border p-3 text-sm"
                    >
                      <div class="text-muted-foreground mb-2">模型</div>
                      <div class="flex items-center gap-2">
                        <span class="font-semibold">{{
                          readinessData.assets.model.count
                        }}</span>
                        <ATag
                          v-if="readinessData.assets.model.count > 0"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </ATag>
                        <ATag v-else color="error" class="text-xs">缺失</ATag>
                      </div>
                    </div>
                    <div
                      class="border-border bg-background rounded border p-3 text-sm"
                    >
                      <div class="text-muted-foreground mb-2">报馆图</div>
                      <span class="font-semibold">{{
                        readinessData.assets.drawing.count
                      }}</span>
                    </div>
                    <div
                      class="border-border bg-background rounded border p-3 text-sm"
                    >
                      <div class="text-muted-foreground mb-2">平面素材</div>
                      <span class="font-semibold">{{
                        readinessData.assets.artwork.count
                      }}</span>
                    </div>
                    <div
                      class="border-border bg-background rounded border p-3 text-sm"
                    >
                      <div class="text-muted-foreground mb-2">清单核验</div>
                      <ATag
                        v-if="readinessData.assets.checklist.verified"
                        color="success"
                        class="text-xs"
                      >
                        已核验
                      </ATag>
                      <ATag v-else color="warning" class="text-xs">
                        未核验
                      </ATag>
                    </div>
                  </div>
                </div>

                <p class="text-muted-foreground m-0 text-sm">
                  {{
                    isPublished
                      ? '方案已上线。修改业务内容或资产会使方案自动下线，需重新整体审核并发布；仅修改备注不受影响。'
                      : '流程：处理全部未就绪项 → 整体审核通过 → 发布。操作按钮位于页面顶部。'
                  }}
                </p>
              </template>
            </div>
          </ATabPane>
        </ATabs>
      </AForm>
    </div>

    <!-- 整体审核弹窗 -->
    <AModal
      v-model:open="reviewModalVisible"
      title="整体审核"
      :confirm-loading="reviewSubmitting"
      :ok-button-props="{ disabled: reviewSubmitDisabled }"
      @ok="handleReviewSubmit"
      ok-text="提交"
      cancel-text="取消"
    >
      <div class="space-y-4">
        <p class="text-muted-foreground m-0 text-sm">
          系统已自动检查资产数量、清单核验与配对规格；以下确认项由审核人对实际内容质量逐项确认。审核结论绑定当前修订，后续修改业务内容或资产会使其失效。
        </p>
        <AForm layout="vertical">
          <AFormItem label="审核结论">
            <ARadioGroup v-model:value="reviewForm.decision">
              <ARadio value="pass">通过</ARadio>
              <ARadio value="reject">不通过</ARadio>
            </ARadioGroup>
          </AFormItem>

          <AFormItem
            v-if="reviewForm.decision === 'pass'"
            label="审核确认（需全部勾选）"
            required
          >
            <div class="flex flex-col gap-2">
              <ACheckbox v-model:checked="reviewForm.checks.assetsComplete">
                六类资产内容正确：效果图、蒙版、模型、清单、报馆图、平面素材
              </ACheckbox>
              <ACheckbox v-model:checked="reviewForm.checks.bomVerified">
                清单条目与模型逐项对应，配套项完整
              </ACheckbox>
              <ACheckbox v-model:checked="reviewForm.checks.renderingsAndMasks">
                效果图与蒙版逐一对齐，换色区域准确
              </ACheckbox>
              <ACheckbox v-model:checked="reviewForm.checks.drawingsComplete">
                报馆图覆盖必需视向，图纸内容正确
              </ACheckbox>
            </div>
          </AFormItem>

          <AFormItem
            :label="reviewForm.decision === 'pass' ? '审核意见（可选）' : '不通过原因'"
            :required="reviewForm.decision === 'reject'"
          >
            <ATextarea
              v-model:value="reviewForm.notes"
              :rows="3"
              :placeholder="
                reviewForm.decision === 'pass'
                  ? '可填写补充说明'
                  : '请填写具体问题，便于整改'
              "
            />
          </AFormItem>
        </AForm>
      </div>
    </AModal>

    <!-- 下架弹窗 -->
    <AModal
      v-model:open="unpublishModalVisible"
      title="下架方案"
      :confirm-loading="unpublishSubmitting"
      @ok="handleUnpublishSubmit"
      ok-text="确认下架"
      cancel-text="取消"
      ok-type="danger"
    >
      <div class="space-y-3">
        <p class="text-muted-foreground">
          下架后，客户端将无法匹配和使用该方案。历史项目引用不受影响。
        </p>
        <AForm layout="vertical">
          <AFormItem label="下架原因（可选）">
            <ATextarea
              v-model:value="unpublishReason"
              :rows="3"
              placeholder="请填写下架原因"
            />
          </AFormItem>
        </AForm>
      </div>
    </AModal>
  </div>
</template>
