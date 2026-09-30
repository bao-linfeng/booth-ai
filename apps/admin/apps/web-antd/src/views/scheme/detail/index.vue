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

import { formatDate } from '@vben/utils';

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

const isCreate = computed(() => route.path === '/scheme/create');
const currentCode = computed(() =>
  route.params.code ? decodeURIComponent(route.params.code as string) : '',
);

const publishButtonDisabled = computed(() => {
  const data = originalData.value;
  return (
    data?.publishStatus === 'published' ||
    data?.verificationStatus === 'verified'
  );
});

const loading = ref(false);
const saving = ref(false);
const activeTab = ref('basic');

const formRef = ref();
const applicabilityConfirmed = ref(false);
const labelsConfirmed = ref(false);
const publicNotes = ref('');

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
    const conditions = res.applicableConditions;
    applicabilityConfirmed.value = conditions?.status === 'confirmed';
    labelsConfirmed.value = conditions?.labelsConfirmed === true;
    publicNotes.value =
      typeof conditions?.publicNotes === 'string' ? conditions.publicNotes : '';

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
        k !== 'editRevision' &&
        res[k as keyof SchemeRecord] !== undefined &&
        res[k as keyof SchemeRecord] !== null
      ) {
        (formData as any)[k] =
          k === 'areaM2' && res.areaM2 !== null
            ? Number(res.areaM2)
            : res[k as keyof SchemeRecord];
      }
    });
    formData.editRevision = res.editRevision;
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

async function fetchChecklistBom() {
  if (!currentCode.value) return;
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

  saving.value = true;
  try {
    const applicableConditions = {
      status: applicabilityConfirmed.value ? 'confirmed' : 'pending',
      rules: Array.isArray(originalData.value?.applicableConditions?.rules)
        ? originalData.value.applicableConditions.rules
        : [],
      labelsConfirmed: labelsConfirmed.value,
      publicNotes: publicNotes.value,
    };
    if (isCreate.value) {
      const res = await createSchemeApi({ ...formData, applicableConditions });
      message.success('创建成功');
      router.replace(`/scheme/detail/${encodeURIComponent(res.code)}`);
    } else {
      const { code: _code, ...editable } = formData;
      const payload: UpdateSchemeInput = {
        ...editable,
        applicableConditions,
        editRevision: formData.editRevision!,
      };
      const res = await updateSchemeApi(currentCode.value, payload);
      message.success('保存成功');
      originalData.value = res;
      formData.editRevision = res.editRevision;
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
      schemeRevision: originalData.value.editRevision,
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

let detailRequestSequence = 0;
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

watch(currentCode, () => {
  detailRequestSequence++;
  checklistRequestSequence++;
  originalData.value = null;
  checklistBom.value = null;
  if (currentCode.value) {
    fetchDetail();
    if (activeTab.value === 'publish') fetchReadiness();
  }
});

watch(activeTab, (tab) => {
  if (tab === 'checklist' && currentCode.value && !checklistBom.value) {
    fetchChecklistBom();
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
          <ATag v-if="originalData.publishStatus === 'published'" color="green">
            已发布
          </ATag>
          <ATag
            v-else-if="originalData.publishStatus === 'unpublished'"
            color="orange"
          >
            未发布
          </ATag>
          <ATag v-else>草稿</ATag>

          <ATag
            v-if="originalData.verificationStatus === 'verified'"
            color="green"
          >
            核验通过
          </ATag>
          <ATag
            v-else-if="originalData.verificationStatus === 'failed'"
            color="red"
          >
            核验失败
          </ATag>
          <ATag v-else>未核验</ATag>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <AButton
          :type="isCreate ? 'primary' : 'default'"
          :loading="saving"
          @click="handleSave"
        >
          保存草稿
        </AButton>
        <template v-if="!isCreate && originalData">
          <AButton
            v-if="originalData.publishStatus !== 'published'"
            @click="openReviewModal"
          >
            整体审核
          </AButton>
          <AButton
            type="primary"
            :loading="publishLoading"
            :disabled="publishButtonDisabled"
            @click="handlePublish"
          >
            发布
          </AButton>
          <AButton
            v-if="originalData.publishStatus === 'published'"
            danger
            @click="openUnpublishModal"
          >
            下架
          </AButton>
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
            <ADivider orientation="left">智选准入核对</ADivider>
            <div class="space-y-3">
              <ACheckbox v-model:checked="applicabilityConfirmed">
                已核对本方案的适用条件，确认没有未录入的限制条款
              </ACheckbox>
              <ACheckbox v-model:checked="labelsConfirmed">
                已核对功能分区和关键特征标签的完整性
              </ACheckbox>
              <AFormItem label="公开适用说明">
                <ATextarea
                  v-model:value="publicNotes"
                  :maxlength="2000"
                  :rows="3"
                  placeholder="仅填写可向客户公开的适用说明，不含内部备注"
                />
              </AFormItem>
              <p class="text-muted-foreground text-xs">
                受控适用问题尚未配置；有额外限制的方案请保持未确认，暂不可发布为智选候选。
              </p>
            </div>
          </ATabPane>

          <ATabPane v-if="!isCreate" key="model" tab="模型">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <span class="text-muted-foreground text-sm">共 {{ modelAssets.length }} 个模型文件</span>
              <AButton
                type="primary"
                :loading="modelUploading"
                @click="handleModelUpload"
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
                >
                  下载
                </AButton>
              </div>
            </div>
          </ATabPane>

          <ATabPane v-if="!isCreate" key="assets" tab="资产汇总">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <ACard
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
                hoverable
                class="text-center"
                @click="router.push(`/assets/masks?schemeCode=${currentCode}`)"
              >
                <div class="text-muted-foreground mb-2">蒙版</div>
                <div class="text-2xl font-semibold">{{ assetCounts.mask }}</div>
              </ACard>
              <ACard
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
              <ACard class="text-center">
                <div class="text-muted-foreground mb-2">模型</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.model }}
                </div>
              </ACard>
              <ACard class="text-center">
                <div class="text-muted-foreground mb-2">清单</div>
                <div class="text-2xl font-semibold">
                  {{ assetCounts.checklist }}
                </div>
              </ACard>
            </div>
          </ATabPane>

          <ATabPane v-if="!isCreate" key="checklist" tab="简化清单">
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

          <ATabPane v-if="!isCreate" key="publish" tab="审核发布">
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
                      <ATag v-if="readinessData.canPublish" color="success">
                        可发布
                      </ATag>
                      <ATag v-else color="warning">未就绪</ATag>
                      <AButton
                        size="small"
                        :loading="readinessLoading"
                        @click="fetchReadiness"
                      >
                        刷新
                      </AButton>
                    </div>
                  </div>
                  <!-- 阻断项 -->
                  <div v-if="readinessData.blockers.length > 0" class="mb-4">
                    <div class="text-destructive mb-2 text-sm font-medium">
                      发布阻断项
                    </div>
                    <div
                      v-for="(blocker, i) in readinessData.blockers"
                      :key="i"
                      class="text-destructive bg-destructive/10 mb-1 rounded px-3 py-2 text-sm"
                    >
                      {{ blocker }}
                    </div>
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
                          v-if="readinessData.assets.rendering.count >= 3"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </ATag>
                        <ATag v-else color="error" class="text-xs">需≥3</ATag>
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
                          v-if="readinessData.assets.mask.count >= 3"
                          color="success"
                          class="text-xs"
                        >
                          ✓
                        </ATag>
                        <ATag v-else color="error" class="text-xs">需≥3</ATag>
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

                <!-- 操作区 -->
                <div class="flex flex-wrap gap-3">
                  <AButton type="primary" ghost @click="openReviewModal">
                    整体审核
                  </AButton>
                  <AButton
                    type="primary"
                    :loading="publishLoading"
                    :disabled="
                      publishButtonDisabled || !readinessData.canPublish
                    "
                    @click="handlePublish"
                  >
                    发布方案
                  </AButton>
                  <AButton
                    v-if="originalData?.publishStatus === 'published'"
                    danger
                    @click="openUnpublishModal"
                  >
                    下架方案
                  </AButton>
                </div>
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
      @ok="handleReviewSubmit"
      ok-text="提交"
      cancel-text="取消"
    >
      <div class="space-y-4">
        <AForm layout="vertical">
          <AFormItem label="审核阶段">
            <ARadioGroup v-model:value="reviewForm.phase">
              <ARadio value="overall">整体审核</ARadio>
              <ARadio value="asset_verification">资产核验</ARadio>
            </ARadioGroup>
          </AFormItem>

          <AFormItem label="审核结论">
            <ARadioGroup v-model:value="reviewForm.decision">
              <ARadio value="pass">通过</ARadio>
              <ARadio value="reject">不通过</ARadio>
            </ARadioGroup>
          </AFormItem>

          <AFormItem label="确认项（通过时建议全选）">
            <div class="space-y-2">
              <ACheckbox v-model:checked="reviewForm.checks.assetsComplete">
                六类资产完整：效果图≥3、蒙版≥3、模型已上传
              </ACheckbox>
              <ACheckbox v-model:checked="reviewForm.checks.bomVerified">
                清单已核验：条目与模型逐项对应
              </ACheckbox>
              <ACheckbox v-model:checked="reviewForm.checks.renderingsAndMasks">
                效果图与蒙版一一配对、尺寸一致
              </ACheckbox>
              <ACheckbox v-model:checked="reviewForm.checks.drawingsComplete">
                报馆图覆盖必需视向
              </ACheckbox>
            </div>
          </AFormItem>

          <AFormItem label="审核意见">
            <ATextarea
              v-model:value="reviewForm.notes"
              :rows="3"
              placeholder="不通过时请填写具体问题"
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
