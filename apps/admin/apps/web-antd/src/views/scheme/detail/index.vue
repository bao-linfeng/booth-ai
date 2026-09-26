<script setup lang="ts">
import type {
  CreateSchemeInput,
  SchemeRecord,
  UpdateSchemeInput,
} from '#/api/core/schemes';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { message } from 'ant-design-vue';

import { listSchemeAssetsApi } from '#/api/core/assets';
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
  loading.value = true;
  try {
    const res = await getSchemeDetailApi(currentCode.value);
    originalData.value = res;

    // Fetch asset counts
    const assets = await listSchemeAssetsApi(currentCode.value);
    assetCounts.rendering = assets.filter((a) => a.type === 'rendering').length;
    assetCounts.mask = assets.filter((a) => a.type === 'mask').length;
    assetCounts.drawing = assets.filter((a) => a.type === 'drawing').length;
    assetCounts.artwork = assets.filter((a) => a.type === 'artwork').length;
    assetCounts.model = assets.filter((a) => a.type === 'model').length;
    assetCounts.checklist = assets.filter((a) => a.type === 'checklist').length;

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
    loading.value = false;
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
      <div>
        <a-button type="primary" :loading="saving" @click="handleSave">
          保存草稿
        </a-button>
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
        </a-tabs>
      </a-form>
    </div>
  </div>
</template>
