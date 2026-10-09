<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted, watch } from "vue";
import { useI18n } from 'vue-i18n';
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
  MessageCircle,
} from "lucide-vue-next";
import { openWith as openCustomerService, setPageContext } from "@/features/customer-service/useCustomerService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ImagePreviewDialog from "@/components/ImagePreviewDialog.vue";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MainLayout from '@/layouts/MainLayout.vue'
import SchemeGallery from "@/features/selection/SchemeGallery.vue";
import { previewItems } from "@/features/selection/preview";
import type { SchemeDetail } from "@/features/selection/types";
import { apiFetch } from "@/lib/api-client";
import { useSignedUrlRenewal } from "@/composables/useSignedUrlRenewal";
import {
  getClientBom,
  downloadClientBom,
  type ClientBomResponse,
} from "@/services/api/bom";
import { downloadSchemeArchive, getSchemeDeliverables, getSchemeDownload, type SchemeAssetType, type SchemeDeliverable } from "@/services/api/scheme-assets";

const { t } = useI18n();
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
    if (request === resourceRequest && activeResource.value === type) resourceError.value = t('schemeDetail.errorLoadFailed');
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
    link.download = `${safeCode}@${type === 'drawings' ? t('schemeDetail.artworkLabel') : t('schemeDetail.flatLabel')}.zip`;
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
      downloadError.value = t('schemeDetail.errorStale');
      await fetchResource(type);
    } else if (response?.status === 413) {
      downloadError.value = t('schemeDetail.errorZipLimit');
    } else if (reason === 'DELIVERABLE_FILENAME_CONFLICT' || reason === 'DELIVERABLE_FILENAME_INVALID') {
      downloadError.value = t('schemeDetail.errorFilename');
    } else if (reason === 'DELIVERABLES_INCOMPLETE') {
      downloadError.value = t('schemeDetail.errorIncomplete');
    } else if (response?.status === 404) {
      previewAsset.value = null;
      resourceItems.value = [];
      resourceRevision.value = '';
      assetUrlMap.value = new Map();
      downloadError.value = t('schemeDetail.errorUnavailable');
    } else {
      downloadError.value = t('schemeDetail.errorZipFailed');
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
    downloadError.value = t('schemeDetail.errorLinkFailed');
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
    if (request === resourceRequest && activeResource.value === type) resourceError.value = t('schemeDetail.errorPreviewFailed');
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
    bomData.value = await getClientBom(schemeCode);
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
    const blob = await downloadClientBom(schemeCode, revision);
    const filename = `${schemeCode.replace(/[\\/:*?"<>|]/g, '_')}@${t('controls.downloadBom')}.xlsx`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e: any) {
    // apiFetch 的 409 会 throw，检查 reason
    if (e?.data?.error?.reason === 'BOM_REVISION_CHANGED' || e?.response?.status === 409 || e?.status === 409) {
      bomRevisionChanged.value = true;
    } else {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(t('schemeDetail.errorDownloadFailed'));
      }
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
      description: t('schemeDetail.previewDescription'),
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

const resources = computed(() => [
  { label: t('schemeDetail.tabThreeViews'), icon: Layers3, type: 'drawings', available: 'drawings' },
  { label: t('schemeDetail.tabFloorPlan'), icon: Image, type: 'artworks', available: 'artworks' },
] as const);

const schemeTitle = computed(() => {
  if (!item.value) return '';
  const spec = item.value.specifications;
  return `${spec.lengthMm / 1000} × ${spec.widthMm / 1000} m · ${t('schemeDetail.boothTitle', { code: spec.productSystemLabel })}`;
});
const specifications = computed(() => {
  if (!item.value) return [];
  const spec = item.value.specifications;
  return [
    { label: t('schemeDetail.specBoothSpace'), value: `${spec.lengthMm / 1000} × ${spec.widthMm / 1000} m` },
    { label: t('schemeDetail.specArea'), value: `${spec.areaM2} ㎡` },
    { label: t('schemeDetail.specHeight'), value: `${spec.heightMm / 1000} m` },
    { label: t('schemeDetail.specOpenings'), value: `${spec.openingCount} ${t('schemeDetail.openingCount')}` },
    { label: t('schemeDetail.specProductSystem'), value: spec.productSystemLabel },
  ];
});
function consultCustomerService() {
  if (item.value?.code) void openCustomerService({ kind: 'scheme', schemeCode: item.value.code }, 'scheme_detail');
}
// 客服输入框的“发送当前方案”：只登记已加载的正式方案，预览示例方案服务端不存在
watch(() => (preview.value ? null : liveData.value?.code ?? null), (code) => {
  setPageContext(code ? { context: { kind: 'scheme', schemeCode: code }, entryPoint: 'scheme_detail', label: code } : null);
}, { immediate: true });
onBeforeUnmount(() => setPageContext(null));
const quoteLocation = computed(() => ({
  path: `/schemes/${encodeURIComponent(item.value?.code ?? '')}/quote`,
  query: {
    entryPoint: showBom.value ? 'bill_of_materials' : 'scheme_detail',
    ...(bomData.value ? { bomRevision: String(bomData.value.revision) } : {}),
    ...(typeof route.query.searchId === 'string' ? { searchId: route.query.searchId } : {}),
  },
}));
const themeLocation = computed(() => ({
  path: `${preview.value ? '/ai-selection/preview' : ''}/schemes/${encodeURIComponent(item.value?.code ?? '')}/theme`,
  query: !preview.value && typeof route.query.searchId === 'string' ? { searchId: route.query.searchId } : {},
}));

// 方案图片为 5 分钟预签名链接：停留过久后图片加载失败或页面重新可见时重新读取详情换新链接，续期失败不影响已展示内容
const imageLinks = useSignedUrlRenewal(() => loadDetail(true), 300_000);
async function loadDetail(renewal = false) {
  try {
    const res = await apiFetch<{ code: number; data: SchemeDetail }>(
      `/api/v1/client/schemes/${encodeURIComponent(route.params.code as string)}`,
    );
    if (res.code === 0) {
      liveData.value = res.data;
      imageLinks.markFresh();
    } else if (!renewal) errorState.value = true;
  } catch (e) {
    if (renewal) return;
    console.error("Failed to load scheme detail", e);
    errorState.value = true;
  }
}
onMounted(() => {
  if (!preview.value) void loadDetail();
});
</script>

<template>
  <MainLayout>
    <main id="main-content" :style="{ '--scheme-actions-height': `${shortcutHeight}px` }" class="studio-page pb-[calc(var(--scheme-actions-height)+1.5rem)] md:pb-[calc(var(--scheme-actions-height)+1.5rem)] lg:pb-12">
      <header class="studio-header">
        <Button as-child variant="ghost" class="-ml-3">
          <RouterLink :to="preview ? '/ai-selection/preview' : '/ai-selection'"><ArrowLeft class="mr-2 size-4" aria-hidden="true" />{{ t('schemeDetail.backToSelection') }}</RouterLink>
        </Button>
        <div v-if="item" class="space-y-3">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span class="break-all font-mono">{{ t('schemeDetail.schemeCode') }} {{ item.code }}</span>
            <Badge v-if="preview" variant="secondary">{{ t('schemeDetail.previewLabel') }}</Badge>
          </div>
          <h1 class="studio-title break-words">{{ schemeTitle }}</h1>
          <p class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>{{ item.specifications.areaM2 }} ㎡</span>
            <span>{{ item.specifications.openingCount }} {{ t('schemeDetail.openingCount') }}</span>
            <span>{{ t('schemeDetail.actualHeight') }} {{ item.specifications.heightMm / 1000 }} m</span>
          </p>
        </div>
      </header>

      <template v-if="item">
        <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-12">
          <section :aria-label="t('schemeDetail.galleryAriaLabel')" class="min-w-0">
            <SchemeGallery :images="item.images" :code="item.code" :preview="preview" :variant="Math.max(0, previewItems.findIndex(i => i.code === item?.code))" @image-error="imageLinks.onImageError" />
            <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{{ preview ? t('schemeDetail.galleryPreviewNote') : t('schemeDetail.galleryNote') }}</p>
          </section>

          <aside aria-labelledby="scheme-summary" class="min-w-0 border-t pt-6 lg:border-t-0 lg:pt-0">
            <h2 id="scheme-summary" class="text-lg font-semibold">{{ t('schemeDetail.summaryTitle') }}</h2>
            <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 border-b pb-6">
              <div v-for="spec in specifications" :key="spec.label" class="min-w-0 space-y-1">
                <dt class="text-xs text-muted-foreground">{{ spec.label }}</dt>
                <dd class="break-words text-base font-medium tabular-nums">{{ spec.value }}</dd>
              </div>
            </dl>
            <div class="space-y-3 py-6">
              <h3 class="font-medium">{{ t('schemeDetail.quoteCallout') }}</h3>
              <p class="text-sm leading-relaxed text-muted-foreground">{{ t('schemeDetail.quoteNote') }}</p>
              <Button v-if="!preview" as-child size="lg" class="w-full"><RouterLink :to="quoteLocation">{{ t('schemeDetail.requestQuote') }}<ArrowUpRight class="ml-2 size-4" aria-hidden="true" /></RouterLink></Button>
              <Button v-else disabled size="lg" class="w-full">{{ t('schemeDetail.previewNoQuote') }}</Button>
              <p class="text-sm leading-relaxed text-muted-foreground">{{ t('schemeDetail.quoteDisclaimer') }}</p>
              <Button v-if="!preview" variant="outline" class="w-full" @click="consultCustomerService"><MessageCircle class="mr-2 size-4" aria-hidden="true" />{{ t('customerService.consult') }}</Button>
            </div>
            <div class="space-y-3 border-t pt-5">
              <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-medium">{{ t('schemeDetail.themeCallout') }}</h3><span class="shrink-0 text-xs text-muted-foreground">{{ t('schemeDetail.themeOptional') }}</span></div>
              <p class="text-sm leading-relaxed text-muted-foreground">{{ t('schemeDetail.themeDesc') }}</p>
              <Button v-if="item.actions?.theme !== 'unavailable'" as-child variant="outline" class="w-full"><RouterLink :to="themeLocation"><Palette class="mr-2 size-4" aria-hidden="true" />{{ t('schemeDetail.themeBtn') }}</RouterLink></Button>
              <Button v-else disabled variant="outline" class="w-full">{{ t('schemeDetail.themeUnavailable') }}</Button>
            </div>
          </aside>
        </div>

        <Tabs v-model="activeTab" class="min-w-0 border-t pt-6">
          <TabsList :aria-label="t('schemeDetail.tabsAriaLabel')" class="grid h-auto w-full grid-cols-3 gap-1 sm:w-fit">
            <TabsTrigger value="description" class="px-2 py-2.5 sm:px-6">{{ t('schemeDetail.tabDescription') }}</TabsTrigger>
            <TabsTrigger value="bom" class="px-2 py-2.5 sm:px-6">{{ t('schemeDetail.tabBom') }}</TabsTrigger>
            <TabsTrigger value="resources" class="px-2 py-2.5 sm:px-6">{{ t('schemeDetail.tabAssets') }}</TabsTrigger>
          </TabsList>

          <TabsContent value="description" class="mt-6 min-w-0 space-y-5">
            <div class="space-y-1"><h2 class="text-lg font-semibold">{{ t('schemeDetail.descriptionTitle') }}</h2><p class="text-sm text-muted-foreground">{{ t('schemeDetail.descriptionHint') }}</p></div>
            <p class="max-w-3xl whitespace-pre-line break-words text-sm leading-7">{{ item.description || t('schemeDetail.noDescription') }}</p>
          </TabsContent>

          <TabsContent value="bom" class="mt-6 min-w-0 space-y-5">
            <div class="space-y-1"><h2 class="text-lg font-semibold">{{ t('schemeDetail.bomTitle') }}</h2><p class="text-sm text-muted-foreground">{{ t('schemeDetail.bomHint') }}</p></div>
            <p v-if="preview" class="rounded-lg bg-muted/50 p-6 text-sm text-muted-foreground">{{ t('schemeDetail.bomPreviewNote') }}</p>
            <template v-else>
              <p v-if="bomLoading" role="status" class="py-8 text-sm text-muted-foreground">{{ t('schemeDetail.bomLoading') }}</p>
              <div v-else-if="bomRevisionChanged" class="space-y-3">
                <p role="status" class="text-sm">{{ t('schemeDetail.bomStale') }}</p>
                <Button size="sm" variant="outline" @click="fetchBom">{{ t('schemeDetail.bomRefresh') }}</Button>
              </div>
              <div v-else-if="bomError" class="space-y-3">
                <p role="alert" class="text-sm text-destructive">{{ t('schemeDetail.bomError') }}</p>
                <Button size="sm" variant="outline" @click="fetchBom">{{ t('common.retry') }}</Button>
              </div>
              <p v-else-if="!bomData" class="py-4 text-sm text-muted-foreground">{{ t('schemeDetail.bomEmpty') }}</p>
              <div v-else class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <span class="text-xs text-muted-foreground">{{ t('schemeDetail.bomMeta', { count: bomData.items.length, revision: bomData.revision }) }}</span>
                  <Button size="sm" variant="outline" :aria-busy="bomDownloading" :disabled="bomDownloading" @click="handleBomDownload">
                    <Loader2 v-if="bomDownloading" class="mr-2 size-4 animate-spin" aria-hidden="true" /><FileText v-else class="mr-2 size-4" aria-hidden="true" />{{ bomDownloading ? t('schemeDetail.bomDownloading') : t('schemeDetail.bomDownload') }}
                  </Button>
                </div>
                <div role="region" :aria-label="t('schemeDetail.bomTableAriaLabel')" tabindex="0" class="max-w-full overflow-x-auto rounded-md bg-card p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <table class="w-full min-w-[760px] text-sm">
                    <caption class="sr-only">{{ t('schemeDetail.bomTableCaption') }}</caption>
                    <thead>
                      <tr class="border-b text-left text-muted-foreground">
                        <th scope="col" class="pb-3 pr-4 font-medium">#</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">{{ t('schemeDetail.bomColName') }}</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">{{ t('schemeDetail.bomColModel') }}</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">{{ t('schemeDetail.bomColSpec') }}</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">{{ t('schemeDetail.bomColQty') }}</th>
                        <th scope="col" class="pb-3 pr-4 font-medium">{{ t('schemeDetail.bomColWeight') }}</th>
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
                <p v-if="bomData.items.length > 50" class="text-xs text-muted-foreground">{{ t('schemeDetail.bomTruncated') }}</p>
              </div>
            </template>
          </TabsContent>

          <TabsContent value="resources" class="mt-6 min-w-0 space-y-6">
            <div class="space-y-1"><h2 class="text-lg font-semibold">{{ t('schemeDetail.assetsTitle') }}</h2><p class="text-sm leading-relaxed text-muted-foreground">{{ t('schemeDetail.assetsHint') }}</p></div>
            <div class="flex flex-wrap gap-3" role="group" :aria-label="t('schemeDetail.assetsTabsAriaLabel')">
              <Button v-for="resource in resources" :key="resource.type" :variant="activeResource === resource.type ? 'default' : 'outline'" :disabled="preview || !item.resources[resource.available]" :aria-expanded="activeResource === resource.type" aria-controls="scheme-resource-list" @click="toggleResource(resource.type)">
                <component :is="resource.icon" class="mr-2 size-4" aria-hidden="true" />{{ resource.label }}<span v-if="!item.resources[resource.available]" class="ml-2 text-xs">{{ t('schemeDetail.assetsEmpty') }}</span>
              </Button>
              <Button variant="outline" :disabled="preview || !item.resources.model || downloadBusy" :aria-busy="downloadingAsset === 'model'" @click="downloadResource('model')"><Box class="mr-2 size-4" aria-hidden="true" />{{ downloadingAsset === 'model' ? t('schemeDetail.assetDownloadingSkp') : t('schemeDetail.assetDownloadSkp') }}</Button>
            </div>
            <p v-if="preview" class="rounded-lg bg-muted/50 p-6 text-sm text-muted-foreground">{{ t('schemeDetail.assetsPreviewNote') }}</p>
            <div id="scheme-resource-list" class="min-w-0 space-y-5">
              <p v-if="!preview && !activeResource" class="py-6 text-sm text-muted-foreground">{{ t('schemeDetail.assetsSelectCategory') }}</p>
              <template v-if="activeResource">
                <p v-if="resourceLoading" role="status" class="py-8 text-sm text-muted-foreground">{{ t('schemeDetail.assetsLoading') }}</p>
                <template v-else>
                  <div v-if="resourceError" role="alert" class="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{{ resourceError }}</p><Button variant="outline" size="sm" @click="fetchResource(activeResource)">{{ t('schemeDetail.assetsReload') }}</Button></div>
                  <p v-if="!resourceError && !resourceItems.length" class="py-6 text-sm text-muted-foreground">{{ t('schemeDetail.assetsUnavailable') }}</p>
                  <template v-if="resourceItems.length">
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                      <div><h3 class="text-sm font-medium">{{ resources.find(resource => resource.type === activeResource)?.label }} · {{ t('schemeDetail.assetsCount', { count: resourceItems.length }) }}</h3><p class="mt-1 text-xs text-muted-foreground">{{ t('schemeDetail.assetsZipHint') }}</p></div>
                      <Button variant="outline" :disabled="downloadBusy || !resourceRevision" :aria-busy="downloadingArchive === activeResource" @click="downloadAllResources(activeResource)"><Loader2 v-if="downloadingArchive === activeResource" class="mr-2 size-4 animate-spin" aria-hidden="true" /><Download v-else class="mr-2 size-4" aria-hidden="true" />{{ downloadingArchive === activeResource ? t('schemeDetail.assetsPacking') : t('schemeDetail.assetsDownloadAll') }}</Button>
                    </div>
                    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      <article v-for="asset in resourceItems" :key="asset.assetId" class="min-w-0 overflow-hidden border-b">
                        <div class="flex aspect-video items-center justify-center rounded-md bg-image-surface p-3">
                          <img v-if="asset.mimeType.startsWith('image/') && assetUrlMap.has(asset.assetId)" :src="assetUrlMap.get(asset.assetId)" :alt="asset.name" loading="lazy" class="h-full w-full object-contain" @error="assetUrlMap.delete(asset.assetId)" />
                          <div v-else class="flex flex-col items-center gap-2 text-muted-foreground"><FileText class="size-8" aria-hidden="true" /><span class="text-xs">{{ asset.mimeType.startsWith('image/') ? t('schemeDetail.assetPreviewClickable') : asset.mimeType === 'application/pdf' ? t('schemeDetail.assetPreviewPdf') : t('schemeDetail.assetPreviewNoPreview') }}</span></div>
                        </div>
                        <div class="space-y-3 p-4">
                          <div class="space-y-1"><h4 class="break-all text-sm font-medium">{{ asset.name }}</h4><p class="break-all text-xs leading-relaxed text-muted-foreground">{{ asset.originalFilename || asset.name }}</p></div>
                          <div class="flex flex-wrap gap-2">
                            <Button v-if="asset.mimeType.startsWith('image/') || asset.mimeType === 'application/pdf'" variant="outline" size="sm" :disabled="!!previewLoading" :aria-label="`${t('schemeDetail.assetPreviewBtn')} ${asset.originalFilename || asset.name}`" :aria-busy="previewLoading === asset.assetId" @click="showResourcePreview(activeResource, asset, $event)"><Eye class="mr-1.5 size-4" aria-hidden="true" />{{ previewLoading === asset.assetId ? t('schemeDetail.assetPreviewLoading') : t('schemeDetail.assetPreviewBtn') }}</Button>
                            <Button variant="outline" size="sm" :disabled="downloadBusy" :aria-label="`${t('schemeDetail.assetDownloadBtn')} ${asset.originalFilename || asset.name}`" @click="downloadResource(activeResource, asset.assetId)"><Download class="mr-1.5 size-4" aria-hidden="true" />{{ downloadingAsset === asset.assetId ? t('schemeDetail.assetDownloadingBtn') : t('schemeDetail.assetDownloadBtn') }}</Button>
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
          :description="t('schemeDetail.previewDialogDesc')"
          content-class="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-lg p-4 sm:p-6"
          image-class="max-h-[65dvh] w-full object-contain"
          :image-error="previewImageError"
          :error-message="t('schemeDetail.previewDialogImageError')"
          @image-error="previewImageError = true"
          @close-auto-focus="restorePreviewFocus"
        >
          <template #content v-if="previewAsset && previewAsset.mimeType === 'application/pdf'">
            <div class="space-y-4 rounded-lg bg-muted/40 p-4">
              <p class="text-sm leading-relaxed">{{ t('schemeDetail.pdfDialogNote') }}</p>
              <Button as-child variant="outline" class="h-auto min-h-11 max-w-full whitespace-normal"><a :href="previewAsset.url" target="_blank" rel="noopener noreferrer">{{ t('schemeDetail.pdfOpenBtn') }}<ArrowUpRight class="size-4" aria-hidden="true" /></a></Button>
            </div>
          </template>
        </ImagePreviewDialog>

        <div ref="shortcutBar" :aria-label="t('schemeDetail.fabAriaLabel')" class="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
          <div class="mx-auto flex max-w-2xl flex-wrap items-stretch gap-3">
            <Button v-if="item.actions?.theme !== 'unavailable'" as-child variant="outline" class="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-28 whitespace-normal px-3"><RouterLink :to="themeLocation">{{ t('schemeDetail.fabTheme') }}</RouterLink></Button>
            <Button v-if="!preview" as-child class="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-28 whitespace-normal px-3"><RouterLink :to="quoteLocation">{{ t('schemeDetail.fabQuote') }}<ArrowUpRight class="size-4" aria-hidden="true" /></RouterLink></Button>
            <Button v-else disabled class="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-28 whitespace-normal px-3">{{ t('schemeDetail.fabPreviewNoQuote') }}</Button>
          </div>
        </div>
      </template>

      <section v-else class="flex min-h-80 flex-col items-center justify-center gap-4 p-6 text-center" aria-live="polite">
        <Box class="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 class="text-xl font-medium">{{ preview ? t('schemeDetail.loadErrorNotFound') : errorState ? t('schemeDetail.loadErrorFailed') : t('schemeDetail.loadErrorLoading') }}</h1>
        <p class="text-sm text-muted-foreground">{{ preview ? t('schemeDetail.loadErrorNotFoundHint') : errorState ? t('schemeDetail.loadErrorFailedHint') : t('schemeDetail.loadErrorLoadingHint') }}</p>
        <Button v-if="errorState || preview" as-child><RouterLink to="/ai-selection">{{ t('schemeDetail.backToSelection2') }}</RouterLink></Button>
      </section>
    </main>
  </MainLayout>
</template>
