<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useRoute } from "vue-router";
import {
  ArrowLeft,
  FileText,
  Image,
  Box,
  Palette,
  Layers3,
  Download,
  Loader2,
  Eye,
  ArrowUpRight,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ImagePreviewDialog from "@/components/ImagePreviewDialog.vue";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MainLayout from '@/layouts/MainLayout.vue'
import SchemeGallery from "@/features/selection/SchemeGallery.vue";
import { previewItems } from "@/features/selection/preview";
import type { SchemeDetail } from "@/features/selection/types";
import { apiFetch } from "@/lib/api-client";
import {
  getClientBomApi,
  downloadClientBomApi,
  type ClientBomResponse,
} from "@/services/api/bom";
import { downloadSchemeArchive, getSchemeDeliverables, getSchemeDownload, type SchemeAssetType, type SchemeDeliverable } from "@/services/api/scheme-assets";

const route = useRoute();
const preview = computed(() => route.path.startsWith("/ai-selection/preview/"));
const liveData = ref<SchemeDetail | null>(null);
const errorState = ref(false);
const bomData = ref<ClientBomResponse | null>(null);
const bomLoading = ref(false);
const bomDownloading = ref(false);
const bomError = ref(false);
const bomRevisionChanged = ref(false);
const activeTab = ref('description');
const shortcutBar = ref<HTMLElement | null>(null);
const shortcutHeight = ref(0);
useResizeObserver(shortcutBar, () => {
  shortcutHeight.value = shortcutBar.value?.getBoundingClientRect().height ?? 0;
});
const showBom = computed(() => activeTab.value === 'bom');
const activeResource = ref<SchemeAssetType | null>(null);
const resourceItems = ref<SchemeDeliverable[]>([]);
const resourceRevision = ref('');
const resourceLoading = ref(false);
const resourceError = ref('');
const downloadError = ref('');
const downloadingAsset = ref<string | null>(null);
const downloadingArchive = ref<SchemeAssetType | null>(null);
const downloadBusy = computed(() => !!downloadingAsset.value || !!downloadingArchive.value);
const previewAsset = ref<{ assetId: string; name: string; url: string; mimeType: string } | null>(null);
const previewOpen = computed({
  get: () => previewAsset.value !== null,
  set: (open: boolean) => { if (!open) previewAsset.value = null; },
});
const previewImageError = ref(false);
let previewTrigger: HTMLElement | null = null;
const previewLoading = ref<string | null>(null);
const assetUrlMap = ref<Map<string, string>>(new Map());
let resourceRequest = 0;

async function fetchAssetUrls(type: SchemeAssetType, items: SchemeDeliverable[]) {
  if (!item.value?.code || preview.value) return;
  const code = item.value.code;
  const request = resourceRequest;
  
  await Promise.all(items.filter(i => i.mimeType.startsWith('image/')).map(async (asset) => {
    try {
      const link = await getSchemeDownload(code, type, asset.assetId, true);
      if (request === resourceRequest && activeResource.value === type && item.value?.code === code) {
        const newMap = new Map(assetUrlMap.value);
        newMap.set(asset.assetId, link.downloadUrl);
        assetUrlMap.value = newMap;
      }
    } catch {
      // ignore
    }
  }));
}

async function toggleResource(type: SchemeAssetType) {
  if (activeResource.value === type) {
    activeResource.value = null;
    resourceRequest++;
    return;
  }
  activeResource.value = type;
  previewAsset.value = null;
  resourceItems.value = [];
  resourceRevision.value = '';
  downloadError.value = '';
  assetUrlMap.value = new Map();
  await fetchResource(type);
}

async function fetchResource(type: SchemeAssetType) {
  if (!item.value?.code || preview.value) return;
  const code = item.value.code;
  const request = ++resourceRequest;
  resourceLoading.value = true;
  resourceError.value = '';
  try {
    const result = await getSchemeDeliverables(code, type);
    if (request === resourceRequest && activeResource.value === type && item.value?.code === code) {
      resourceItems.value = result.items;
      resourceRevision.value = result.revision;
      fetchAssetUrls(type, result.items);
    }
  } catch {
    if (request === resourceRequest && activeResource.value === type) resourceError.value = '资料加载失败，请重试';
  } finally {
    if (request === resourceRequest && activeResource.value === type) resourceLoading.value = false;
  }
}

async function downloadAllResources(type: SchemeAssetType) {
  if (!item.value?.code || preview.value || downloadBusy.value || resourceLoading.value ||
    activeResource.value !== type || !resourceItems.value.length || !resourceRevision.value) return;
  const code = item.value.code;
  downloadingArchive.value = type;
  downloadError.value = '';
  try {
    const blob = await downloadSchemeArchive(code, type, resourceRevision.value);
    const safeCode = code.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeCode}@${type === 'drawings' ? '报馆图素材' : '平面素材'}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error: unknown) {
    if (activeResource.value !== type || item.value?.code !== code) return;
    const response = error && typeof error === 'object' && 'response' in error ? error.response as Response | undefined : undefined;
    let reason: string | undefined;
    try {
      const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
      const body = (data instanceof Blob ? JSON.parse(await data.text()) : data) as { error?: { reason?: string } } | undefined;
      reason = body?.error?.reason;
    } catch {}
    if (reason === 'DELIVERABLE_REVISION_CHANGED') {
      previewAsset.value = null;
      resourceItems.value = [];
      resourceRevision.value = '';
      assetUrlMap.value = new Map();
      downloadError.value = '资料已更新，请确认刷新后的列表，再重新下载。';
      await fetchResource(type);
    } else if (response?.status === 413) {
      downloadError.value = '资料超过批量下载上限（30 个文件 / 50 MiB），请逐张下载或联系工作人员交接。';
    } else if (reason === 'DELIVERABLE_FILENAME_CONFLICT' || reason === 'DELIVERABLE_FILENAME_INVALID') {
      downloadError.value = '资料文件名重复或不符合规范，请联系工作人员修正后重试。';
    } else if (reason === 'DELIVERABLES_INCOMPLETE') {
      downloadError.value = '配套资料尚不完整，请联系工作人员补齐后重试。';
    } else if (response?.status === 404) {
      previewAsset.value = null;
      resourceItems.value = [];
      resourceRevision.value = '';
      assetUrlMap.value = new Map();
      downloadError.value = '方案或配套资料暂不可用，请刷新页面后重试。';
    } else {
      downloadError.value = '打包下载失败，可能有原件缺失或读取异常，请重试；持续失败请联系工作人员。';
    }
  } finally {
    downloadingArchive.value = null;
  }
}

async function downloadResource(type: SchemeAssetType | 'model', assetId?: string) {
  if (!item.value?.code || downloadBusy.value || preview.value) return;
  downloadingAsset.value = assetId ?? 'model';
  downloadError.value = '';
  try {
    const result = await getSchemeDownload(item.value.code, type, assetId);
    const link = document.createElement('a');
    link.href = result.downloadUrl;
    link.download = result.filename;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    downloadError.value = '下载链接获取失败，请重试';
  } finally {
    downloadingAsset.value = null;
  }
}

async function showResourcePreview(type: SchemeAssetType, asset: SchemeDeliverable, event: MouseEvent) {
  if (!item.value?.code || previewLoading.value) return;
  const code = item.value.code;
  const request = resourceRequest;
  previewTrigger = event.currentTarget as HTMLElement;
  previewLoading.value = asset.assetId;
  previewImageError.value = false;
  resourceError.value = '';
  try {
    const link = await getSchemeDownload(code, type, asset.assetId, true);
    if (request === resourceRequest && activeResource.value === type && item.value?.code === code && activeTab.value === 'resources') {
      previewAsset.value = { assetId: asset.assetId, name: asset.originalFilename || asset.name, url: link.downloadUrl, mimeType: link.mimeType };
    }
  } catch {
    if (request === resourceRequest && activeResource.value === type) resourceError.value = '预览加载失败，请重试';
  } finally {
    previewLoading.value = null;
  }
}

function restorePreviewFocus(event: Event) {
  event.preventDefault();
  previewTrigger?.focus();
}

async function fetchBom() {
  if (!item.value?.code || bomLoading.value) return;
  const schemeCode = item.value.code;
  bomLoading.value = true;
  bomError.value = false;
  bomRevisionChanged.value = false;
  try {
    bomData.value = await getClientBomApi(schemeCode);
  } catch (e: any) {
    if (e?.status === 409 || e?.response?.status === 409) {
      bomData.value = null;
    } else {
      bomError.value = true;
    }
  } finally {
    bomLoading.value = false;
  }
}

async function handleBomDownload() {
  if (!bomData.value || bomDownloading.value) return;
  const { schemeCode, revision } = bomData.value;
  bomDownloading.value = true;
  bomRevisionChanged.value = false;
  try {
    const response = await downloadClientBomApi(schemeCode, revision);
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('json')) {
        const err = await response.json();
        if (err?.error?.reason === 'BOM_REVISION_CHANGED') {
          bomRevisionChanged.value = true;
          return;
        }
      }
      throw new Error('下载失败');
    }
    // 严格校验 MIME，防止把非 XLSX 内容保存成文件
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('spreadsheetml') && !contentType.includes('spreadsheet')) {
      throw new Error('下载内容类型异常');
    }
    const blob = await response.blob();
    const filename = `${schemeCode.replace(/[\\/:*?"<>|]/g, '_')}@简化清单.xlsx`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e: any) {
    // apiFetch 的 409 会 throw，检查 reason
    if (e?.data?.error?.reason === 'BOM_REVISION_CHANGED' || e?.response?.status === 409) {
      bomRevisionChanged.value = true;
    } else {
      alert('下载失败，请重试');
    }
  } finally {
    bomDownloading.value = false;
  }
}

watch(activeTab, () => {
  if (preview.value) return;
  if (showBom.value && !bomData.value && !bomLoading.value) {
    void fetchBom();
  }
});

const item = computed(() => {
  if (preview.value) {
    const matched = previewItems.find(
      (item) => item.code === route.params.code,
    );
    if (!matched) return undefined;
    return {
      code: matched.code,
      images: matched.images,
      specifications: matched.specifications,
      applicabilityNotes:
        "此处展示方案经审核的公开适用说明。选择前请确认场馆限高、开口面数以及搭建规范。",
      resources: {
        model: true,
        bom: true,
        renderings: true,
        masks: true,
        drawings: true,
        artworks: true,
      },
      actions: {
        theme: "available",
        bom: "unavailable",
        drawings: "unavailable",
        artworks: "unavailable",
        quote: "unavailable",
        modelDownload: "unavailable",
      } as const,
    };
  }
  return liveData.value;
});

const resources = [
  { label: "三视图", icon: Layers3, type: 'drawings', available: 'drawings' },
  { label: "标准平面素材", icon: Image, type: 'artworks', available: 'artworks' },
] as const;

const schemeTitle = computed(() => {
  if (!item.value) return '';
  const spec = item.value.specifications;
  return `${spec.lengthMm / 1000} × ${spec.widthMm / 1000} m · ${spec.productSystemLabel}展台`;
});
const specifications = computed(() => {
  if (!item.value) return [];
  const spec = item.value.specifications;
  return [
    { label: '展位尺寸', value: `${spec.lengthMm / 1000} × ${spec.widthMm / 1000} m` },
    { label: '占地面积', value: `${spec.areaM2} ㎡` },
    { label: '方案实际高度', value: `${spec.heightMm / 1000} m` },
    { label: '开口数量', value: `${spec.openingCount} 面` },
    { label: '产品体系', value: spec.productSystemLabel },
  ];
});
const quoteLocation = computed(() => ({
  path: `/schemes/${encodeURIComponent(item.value?.code ?? '')}/quote`,
  query: {
    entryPoint: showBom.value ? 'bill_of_materials' : 'scheme_detail',
    ...(bomData.value ? { bomRevision: String(bomData.value.revision) } : {}),
  },
}));
const themeLocation = computed(() => ({
  path: `${preview.value ? '/ai-selection/preview' : ''}/schemes/${encodeURIComponent(item.value?.code ?? '')}/theme`,
  query: !preview.value && typeof route.query.searchId === 'string' ? { searchId: route.query.searchId } : {},
}));

onMounted(async () => {
  if (preview.value) return;
  try {
    const res = await apiFetch<{ code: number; data: SchemeDetail }>(
      `/api/v1/client/schemes/${encodeURIComponent(route.params.code as string)}`,
    );
    if (res.code === 0) liveData.value = res.data;
    else errorState.value = true;
  } catch (e) {
    console.error("Failed to load scheme detail", e);
    errorState.value = true;
  }
});
</script>

<template>
  <MainLayout>
    <main id="main-content" :style="{ '--scheme-actions-height': `${shortcutHeight}px` }" class="studio-page pb-[calc(var(--scheme-actions-height)+1.5rem)] md:pb-[calc(var(--scheme-actions-height)+1.5rem)] lg:pb-12">
      <header class="studio-header">
        <Button as-child variant="ghost" class="-ml-3">
          <RouterLink :to="preview ? '/ai-selection/preview' : '/ai-selection'"><ArrowLeft class="mr-2 size-4" aria-hidden="true" />返回 AI 智选</RouterLink>
        </Button>
        <div v-if="item" class="space-y-3">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span class="break-all font-mono">方案编号 {{ item.code }}</span>
            <Badge v-if="preview" variant="secondary">静态示例 · 非已发布方案</Badge>
          </div>
          <h1 class="studio-title break-words">{{ schemeTitle }}</h1>
          <p class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>{{ item.specifications.areaM2 }} ㎡</span>
            <span>{{ item.specifications.openingCount }} 面开口</span>
            <span>实际高度 {{ item.specifications.heightMm / 1000 }} m</span>
          </p>
        </div>
      </header>

      <template v-if="item">
        <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-12">
          <section aria-label="方案效果图与多视角" class="min-w-0">
            <SchemeGallery :images="item.images" :code="item.code" :preview="preview" :variant="Math.max(0, previewItems.findIndex(i => i.code === item?.code))" />
            <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{{ preview ? '空间示意，非真实方案效果图。' : '效果图用于空间与视觉参考，支持切换视角及放大查看。' }}</p>
          </section>

          <aside aria-labelledby="scheme-summary" class="min-w-0 border-t pt-6 lg:border-t-0 lg:pt-0">
            <h2 id="scheme-summary" class="text-lg font-semibold">方案摘要</h2>
            <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 border-b pb-6">
              <div v-for="spec in specifications" :key="spec.label" class="min-w-0 space-y-1">
                <dt class="text-xs text-muted-foreground">{{ spec.label }}</dt>
                <dd class="break-words text-base font-medium tabular-nums">{{ spec.value }}</dd>
              </div>
            </dl>
            <div class="space-y-3 py-6">
              <h3 class="font-medium">以此方案，开始报价</h3>
              <p class="text-sm leading-relaxed text-muted-foreground">可直接使用标准方案申请报价，无需先生成主题或素材。</p>
              <Button v-if="!preview" as-child size="lg" class="w-full"><RouterLink :to="quoteLocation">申请报价<ArrowUpRight class="ml-2 size-4" aria-hidden="true" /></RouterLink></Button>
              <Button v-else disabled size="lg" class="w-full">示例方案不可申请报价</Button>
              <p class="text-sm leading-relaxed text-muted-foreground">适用条件与方案差异需经专业确认后，才能进入项目施工交付。</p>
            </div>
            <div class="space-y-3 border-t pt-5">
              <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-medium">让空间呈现您的品牌</h3><span class="shrink-0 text-xs text-muted-foreground">可选</span></div>
              <p class="text-sm leading-relaxed text-muted-foreground">以品牌色与视觉偏好探索不同主题。</p>
              <Button v-if="item.actions?.theme !== 'unavailable'" as-child variant="outline" class="w-full"><RouterLink :to="themeLocation"><Palette class="mr-2 size-4" aria-hidden="true" />AI 换主题</RouterLink></Button>
              <Button v-else disabled variant="outline" class="w-full">AI 换主题 · 暂不可用</Button>
            </div>
          </aside>
        </div>

        <Tabs v-model="activeTab" class="min-w-0 border-t pt-6">
          <TabsList aria-label="方案详细资料" class="grid h-auto w-full grid-cols-3 gap-1 sm:w-fit">
            <TabsTrigger value="description" class="px-2 py-2.5 sm:px-6">方案说明</TabsTrigger>
            <TabsTrigger value="bom" class="px-2 py-2.5 sm:px-6">物料清单</TabsTrigger>
            <TabsTrigger value="resources" class="px-2 py-2.5 sm:px-6">图纸与素材</TabsTrigger>
          </TabsList>

          <TabsContent value="description" class="mt-6">
            <div class="grid gap-6 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
              <div><h2 class="text-lg font-semibold">适用说明</h2><p class="mt-2 text-sm text-muted-foreground">了解方案，再确认参展条件。</p></div>
              <div class="min-w-0 space-y-5 text-sm leading-7">
                <p class="whitespace-pre-line break-words">{{ item.applicabilityNotes || '暂无补充适用说明。' }}</p>
                <p class="border-l-2 border-primary/40 pl-4 text-muted-foreground">直接打开详情仅展示方案规格，不代表方案已符合您的参展条件。选择前请确认场馆限高、开口面数以及搭建规范。</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bom" class="mt-6 min-w-0 space-y-5">
            <div class="space-y-1"><h2 class="text-lg font-semibold">物料清单</h2><p class="text-sm text-muted-foreground">查看标准方案用料，或下载完整清单。</p></div>
            <p v-if="preview" class="rounded-lg bg-muted/50 p-6 text-sm text-muted-foreground">静态示例不提供真实物料清单，请在已发布方案中查看。</p>
            <template v-else>
              <p v-if="bomLoading" role="status" class="py-8 text-sm text-muted-foreground">正在加载清单…</p>
              <div v-else-if="bomRevisionChanged" class="space-y-3">
                <p role="status" class="text-sm">清单已更新，请刷新后重新下载。</p>
                <Button size="sm" variant="outline" @click="fetchBom">刷新清单</Button>
              </div>
              <div v-else-if="bomError" class="space-y-3">
                <p role="alert" class="text-sm text-destructive">清单加载失败，请重试。</p>
                <Button size="sm" variant="outline" @click="fetchBom">重试</Button>
              </div>
              <p v-else-if="!bomData" class="py-4 text-sm text-muted-foreground">当前方案暂无可用清单</p>
              <div v-else class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <span class="text-xs text-muted-foreground">共 {{ bomData.items.length }} 条 · 修订 {{ bomData.revision }}</span>
                  <Button size="sm" variant="outline" :aria-busy="bomDownloading" :disabled="bomDownloading" @click="handleBomDownload">
                    <Loader2 v-if="bomDownloading" class="mr-2 size-4 animate-spin" aria-hidden="true" /><FileText v-else class="mr-2 size-4" aria-hidden="true" />{{ bomDownloading ? '下载中…' : '下载 XLSX' }}
                  </Button>
                </div>
                <div role="region" aria-label="物料明细，可横向滚动" tabindex="0" class="max-w-full overflow-x-auto rounded-md bg-card p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <table class="w-full min-w-[760px] text-sm">
                    <caption class="sr-only">标准方案物料明细</caption>
                    <thead>
                      <tr class="border-b text-left text-muted-foreground">
                        <th scope="col" class="pb-3 pr-4 font-medium">#</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">名称</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">型号</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">规格(mm)</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">数量</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">重量合计/kg</th>
                        <th scope="col" class="pb-3 font-medium">ERP</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="material in bomData.items.slice(0, 50)" :key="material.id" class="border-b last:border-0">
                        <td class="py-3 pr-4 tabular-nums">{{ material.ordinal }}</td>
                        <td class="max-w-64 whitespace-normal break-words py-3 pr-4">{{ material.productName }}</td>
                        <td class="py-3 pr-4 font-mono text-xs">{{ material.productModel ?? '—' }}</td>
                        <td class="py-3 pr-4">{{ material.specificationMm ?? '—' }}</td>
                        <td class="py-3 pr-4 tabular-nums">{{ material.quantity }} <span class="text-muted-foreground">{{ material.measurementKind === 'length' ? 'm' : material.measurementKind === 'area' ? 'm²' : material.sourceUnit }}</span></td>
                        <td class="py-3 pr-4 tabular-nums">{{ material.totalWeightKg ?? '—' }}</td>
                        <td class="py-3 font-mono text-xs">{{ material.erpCode ?? '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-if="bomData.items.length > 50" class="text-xs text-muted-foreground">显示前 50 条，下载 XLSX 获取完整清单</p>
              </div>
            </template>
          </TabsContent>

          <TabsContent value="resources" class="mt-6 min-w-0 space-y-6">
            <div class="space-y-1"><h2 class="text-lg font-semibold">图纸与素材</h2><p class="text-sm leading-relaxed text-muted-foreground">资料取自当前已发布方案，具体项目施工资料需另行确认。</p></div>
            <div class="flex flex-wrap gap-3" role="group" aria-label="资料类别">
              <Button v-for="resource in resources" :key="resource.type" :variant="activeResource === resource.type ? 'default' : 'outline'" :disabled="preview || !item.resources[resource.available]" :aria-expanded="activeResource === resource.type" aria-controls="scheme-resource-list" @click="toggleResource(resource.type)">
                <component :is="resource.icon" class="mr-2 size-4" aria-hidden="true" />{{ resource.label }}<span v-if="!item.resources[resource.available]" class="ml-2 text-xs">暂无资料</span>
              </Button>
              <Button variant="outline" :disabled="preview || !item.resources.model || downloadBusy" :aria-busy="downloadingAsset === 'model'" @click="downloadResource('model')"><Box class="mr-2 size-4" aria-hidden="true" />{{ downloadingAsset === 'model' ? '获取下载链接…' : '下载 SKP 模型' }}</Button>
            </div>
            <p v-if="preview" class="rounded-lg bg-muted/50 p-6 text-sm text-muted-foreground">静态示例不提供真实图纸与素材下载。</p>
            <div id="scheme-resource-list" class="min-w-0 space-y-5">
              <p v-if="!preview && !activeResource" class="py-6 text-sm text-muted-foreground">选择资料类别，查看文件预览及下载。</p>
              <template v-if="activeResource">
                <p v-if="resourceLoading" role="status" class="py-8 text-sm text-muted-foreground">正在加载资料…</p>
                <template v-else>
                  <div v-if="resourceError" role="alert" class="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{{ resourceError }}</p><Button variant="outline" size="sm" @click="fetchResource(activeResource)">重新加载资料</Button></div>
                  <p v-if="!resourceError && !resourceItems.length" class="py-6 text-sm text-muted-foreground">暂无可用资料</p>
                  <template v-if="resourceItems.length">
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                      <div><h3 class="text-sm font-medium">{{ resources.find(resource => resource.type === activeResource)?.label }} · {{ resourceItems.length }} 份</h3><p class="mt-1 text-xs text-muted-foreground">ZIP 打包下载，保留原文件名</p></div>
                      <Button variant="outline" :disabled="downloadBusy || !resourceRevision" :aria-busy="downloadingArchive === activeResource" @click="downloadAllResources(activeResource)"><Loader2 v-if="downloadingArchive === activeResource" class="mr-2 size-4 animate-spin" aria-hidden="true" /><Download v-else class="mr-2 size-4" aria-hidden="true" />{{ downloadingArchive === activeResource ? '打包中…' : '下载全部' }}</Button>
                    </div>
                    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      <article v-for="asset in resourceItems" :key="asset.assetId" class="min-w-0 overflow-hidden border-b">
                        <div class="flex aspect-video items-center justify-center rounded-md bg-image-surface p-3">
                          <img v-if="asset.mimeType.startsWith('image/') && assetUrlMap.has(asset.assetId)" :src="assetUrlMap.get(asset.assetId)" :alt="asset.name" loading="lazy" class="h-full w-full object-contain" @error="assetUrlMap.delete(asset.assetId)" />
                          <div v-else class="flex flex-col items-center gap-2 text-muted-foreground"><FileText class="size-8" aria-hidden="true" /><span class="text-xs">{{ asset.mimeType.startsWith('image/') ? '可点击预览查看原图' : asset.mimeType === 'application/pdf' ? 'PDF 文档' : '下载文件查看' }}</span></div>
                        </div>
                        <div class="space-y-3 p-4">
                          <div class="space-y-1"><h4 class="break-all text-sm font-medium">{{ asset.name }}</h4><p class="break-all text-xs leading-relaxed text-muted-foreground">{{ asset.originalFilename || asset.name }}</p></div>
                          <div class="flex flex-wrap gap-2">
                            <Button v-if="asset.mimeType.startsWith('image/') || asset.mimeType === 'application/pdf'" variant="outline" size="sm" :disabled="!!previewLoading" :aria-label="`预览 ${asset.originalFilename || asset.name}`" :aria-busy="previewLoading === asset.assetId" @click="showResourcePreview(activeResource, asset, $event)"><Eye class="mr-1.5 size-4" aria-hidden="true" />{{ previewLoading === asset.assetId ? '加载中…' : '预览' }}</Button>
                            <Button variant="outline" size="sm" :disabled="downloadBusy" :aria-label="`下载 ${asset.originalFilename || asset.name}`" @click="downloadResource(activeResource, asset.assetId)"><Download class="mr-1.5 size-4" aria-hidden="true" />{{ downloadingAsset === asset.assetId ? '获取中…' : '下载' }}</Button>
                          </div>
                        </div>
                      </article>
                    </div>
                  </template>
                </template>
              </template>
            </div>
            <p v-if="downloadError" role="alert" class="text-sm text-destructive">{{ downloadError }}</p>
          </TabsContent>
        </Tabs>

        <ImagePreviewDialog
          v-model:open="previewOpen"
          :src="previewAsset?.mimeType.startsWith('image/') ? previewAsset.url : undefined"
          :alt="previewAsset?.name"
          :title="previewAsset?.name"
          description="标准方案配套资料预览，具体项目施工资料需另行确认。"
          content-class="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-lg p-4 sm:p-6"
          image-class="max-h-[65dvh] w-full object-contain"
          :image-error="previewImageError"
          error-message="图片加载失败，请关闭后重试或下载原文件。"
          @image-error="previewImageError = true"
          @close-auto-focus="restorePreviewFocus"
        >
          <template #content v-if="previewAsset && previewAsset.mimeType === 'application/pdf'">
            <div class="space-y-4 rounded-lg bg-muted/40 p-4">
              <p class="text-sm leading-relaxed">PDF 原件将在新标签页中打开，可使用浏览器的阅读与下载功能。当前弹窗可按 Escape 关闭。</p>
              <Button as-child variant="outline" class="h-auto min-h-11 max-w-full whitespace-normal"><a :href="previewAsset.url" target="_blank" rel="noopener noreferrer">新标签页查看 PDF 原件<ArrowUpRight class="size-4" aria-hidden="true" /></a></Button>
            </div>
          </template>
        </ImagePreviewDialog>

        <div ref="shortcutBar" aria-label="方案快捷操作" class="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
          <div class="mx-auto flex max-w-2xl flex-wrap items-stretch gap-3">
            <Button v-if="item.actions?.theme !== 'unavailable'" as-child variant="outline" class="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-28 whitespace-normal px-3"><RouterLink :to="themeLocation">AI 换主题</RouterLink></Button>
            <Button v-if="!preview" as-child class="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-28 whitespace-normal px-3"><RouterLink :to="quoteLocation">申请报价<ArrowUpRight class="size-4" aria-hidden="true" /></RouterLink></Button>
            <Button v-else disabled class="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-28 whitespace-normal px-3">示例不可报价</Button>
          </div>
        </div>
      </template>

      <section v-else class="flex min-h-80 flex-col items-center justify-center gap-4 p-6 text-center" aria-live="polite">
        <Box class="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 class="text-xl font-medium">{{ preview ? '未找到该示例' : errorState ? '方案详情加载失败' : '加载中…' }}</h1>
        <p class="text-sm text-muted-foreground">{{ preview ? '请从静态预览方案卡片进入。' : errorState ? '公开详情将读取最新已发布数据，该方案可能已下架或不存在。' : '正在获取最新方案详情。' }}</p>
        <Button v-if="errorState || preview" as-child><RouterLink to="/ai-selection">返回选型</RouterLink></Button>
      </section>
    </main>
  </MainLayout>
</template>
