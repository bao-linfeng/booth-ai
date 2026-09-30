<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import {
  ArrowLeft,
  FileText,
  Image,
  Box,
  Palette,
  Layers3,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import SelectionShell from "@/features/selection/SelectionShell.vue";
import SchemeGallery from "@/features/selection/SchemeGallery.vue";
import { previewItems } from "@/features/selection/preview";
import type { SchemeDetail } from "@/features/selection/types";
import { apiFetch } from "@/lib/api-client";
import { getThemeModels, type ThemeModel } from "@/services/api/theme-models";
import {
  getClientBomApi,
  downloadClientBomApi,
  type ClientBomResponse,
} from "@/services/api/bom";
import { getSchemeDeliverables, getSchemeDownload, type SchemeAssetType, type SchemeDeliverable } from "@/services/api/scheme-assets";

const route = useRoute();
const preview = computed(() => route.path.startsWith("/ai-selection/preview/"));
const liveData = ref<SchemeDetail | null>(null);
const errorState = ref(false);
const themeModels = ref<ThemeModel[]>([]);
const selectedThemeModel = ref<ThemeModel['provider'] | ''>('');
const themeModelsError = ref(false);
const selectedThemePrice = computed(() => themeModels.value.find(model => model.provider === selectedThemeModel.value)?.unitCredits);

async function fetchThemeModels() {
  themeModelsError.value = false;
  try {
    themeModels.value = await getThemeModels();
    selectedThemeModel.value = themeModels.value[0]?.provider ?? '';
  } catch { themeModelsError.value = true; }
}

const bomData = ref<ClientBomResponse | null>(null);
const bomLoading = ref(false);
const bomDownloading = ref(false);
const bomError = ref(false);
const bomRevisionChanged = ref(false);
const showBom = ref(false);
const activeResource = ref<SchemeAssetType | null>(null);
const resourceItems = ref<SchemeDeliverable[]>([]);
const resourceLoading = ref(false);
const resourceError = ref('');
const downloadError = ref('');
const downloadingAsset = ref<string | null>(null);
const previewAsset = ref<{ assetId: string; url: string; mimeType: string } | null>(null);
const previewLoading = ref<string | null>(null);

async function toggleResource(type: SchemeAssetType) {
  if (activeResource.value === type) {
    activeResource.value = null;
    return;
  }
  activeResource.value = type;
  previewAsset.value = null;
  resourceItems.value = [];
  await fetchResource(type);
}

async function fetchResource(type: SchemeAssetType) {
  if (!item.value?.code || preview.value) return;
  const code = item.value.code;
  resourceLoading.value = true;
  resourceError.value = '';
  try {
    const result = await getSchemeDeliverables(code, type);
    if (activeResource.value === type && item.value?.code === code) resourceItems.value = result.items;
  } catch {
    if (activeResource.value === type) resourceError.value = '资料加载失败，请重试';
  } finally {
    if (activeResource.value === type) resourceLoading.value = false;
  }
}

async function downloadResource(type: SchemeAssetType | 'model', assetId?: string) {
  if (!item.value?.code || downloadingAsset.value || preview.value) return;
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

async function showResourcePreview(type: SchemeAssetType, asset: SchemeDeliverable) {
  if (!item.value?.code || previewLoading.value) return;
  if (previewAsset.value?.assetId === asset.assetId) {
    previewAsset.value = null;
    return;
  }
  previewLoading.value = asset.assetId;
  resourceError.value = '';
  try {
    const link = await getSchemeDownload(item.value.code, type, asset.assetId, true);
    if (activeResource.value === type) previewAsset.value = { assetId: asset.assetId, url: link.downloadUrl, mimeType: link.mimeType };
  } catch {
    resourceError.value = '预览加载失败，请重试';
  } finally {
    previewLoading.value = null;
  }
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

function toggleBom() {
  if (preview.value) return;
  showBom.value = !showBom.value;
  if (showBom.value && !bomData.value && !bomLoading.value) {
    fetchBom();
  }
}

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
  { label: "平面素材", icon: Image, type: 'artworks', available: 'artworks' },
] as const;

onMounted(async () => {
  if (preview.value) return;
  void fetchThemeModels();
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
  <SelectionShell
    ><main class="container mx-auto space-y-6 px-4 py-8 md:px-6 lg:px-8">
      <Button as-child variant="ghost" class="-ml-3"
        ><RouterLink :to="preview ? '/ai-selection/preview' : '/ai-selection'"
          ><ArrowLeft class="mr-2 size-4" />返回 AI 智选</RouterLink
        ></Button
      ><template v-if="item"
        ><div class="flex flex-wrap items-center justify-between gap-4">
          <div class="space-y-2">
            <h1 class="break-all font-mono text-2xl font-semibold md:text-3xl">
              {{ item.code }}
            </h1>
            <p class="text-sm text-muted-foreground">方案规格与适用说明</p>
          </div>
          <Badge v-if="preview" variant="secondary"
            >静态示例 · 非已发布方案</Badge
          >
        </div>
        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div class="min-w-0 space-y-6">
            <Card
              ><CardContent class="p-4"
                ><SchemeGallery
                  :images="item.images"
                  :code="item.code"
                  :preview="preview"
                  :variant="
                    previewItems.findIndex((i) => i.code === item?.code) >= 0
                      ? previewItems.findIndex((i) => i.code === item?.code)
                      : 0
                  " /></CardContent></Card
            ><Card
              ><CardHeader
                ><CardTitle class="text-base">空间规格</CardTitle></CardHeader
              ><CardContent
                ><dl class="grid grid-cols-2 gap-6 md:grid-cols-3">
                  <div
                    v-for="spec in [
                      {
                        label: '展位尺寸',
                        value: `${item.specifications.lengthMm / 1000} × ${item.specifications.widthMm / 1000} m`,
                      },
                      {
                        label: '占地面积',
                        value: `${item.specifications.areaM2} ㎡`,
                      },
                      {
                        label: '方案实际高度',
                        value: `${item.specifications.heightMm / 1000} m`,
                      },
                      {
                        label: '产品体系',
                        value: item.specifications.productSystemLabel,
                      },
                      {
                        label: '开口数量',
                        value: `${item.specifications.openingCount} 面`,
                      },
                    ]"
                    :key="spec.label"
                    class="space-y-2"
                  >
                    <dt class="text-xs text-muted-foreground">
                      {{ spec.label }}
                    </dt>
                    <dd class="text-sm font-medium">{{ spec.value }}</dd>
                  </div>
                </dl></CardContent
              ></Card
            ><Card
              ><CardHeader
                ><CardTitle class="text-base">适用说明</CardTitle></CardHeader
              ><CardContent class="space-y-3 text-sm leading-relaxed"
                ><p>{{ item.applicabilityNotes || "暂无补充适用说明。" }}</p>
                <p class="text-xs text-muted-foreground">
                  直接打开详情仅展示方案规格，不代表方案已符合您的参展条件。
                </p></CardContent
              ></Card
            >
          </div>
          <aside class="space-y-6">
            <Card
              ><CardHeader
                ><Palette class="mb-2 size-6 text-primary" /><CardTitle
                  class="text-lg"
                  >让空间呈现您的品牌</CardTitle
                ><CardDescription
                  >以品牌色与视觉素材探索不同主题。</CardDescription
                ></CardHeader
              ><CardContent class="space-y-3"
                 ><div v-if="themeModels.length" class="space-y-2">
                   <label class="block text-sm font-medium">选择图像模型</label>
                   <Select :model-value="selectedThemeModel" @update:model-value="selectedThemeModel = $event as any">
                     <SelectTrigger class="w-full">
                       <SelectValue placeholder="选择图像模型" />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem v-for="model in themeModels" :key="model.provider" :value="model.provider">
                         {{ model.provider === 'gemini' ? 'Gemini Nano Banana' : model.provider === 'openai' ? 'GPT Image (OpenAI)' : '通义万相' }} · {{ model.unitCredits }} 积分/张
                       </SelectItem>
                     </SelectContent>
                   </Select>
                   <p class="text-sm">当前预计：{{ selectedThemePrice }} 积分 / 张</p>
                 </div>
                 <p v-else-if="themeModelsError" class="text-xs text-destructive">模型费用加载失败，请重试。</p>
                 <p v-else class="text-xs text-muted-foreground">当前暂无可用的图像模型。</p>
                 <Button
                   v-if="item.actions?.theme !== 'unavailable'"
                   as-child
                   class="w-full"
                 >
                   <RouterLink :to="preview ? `/ai-selection/preview/schemes/${item.code}/theme` : `/schemes/${item.code}/theme`">
                     <Palette class="mr-2 size-4" />AI 换主题
                   </RouterLink>
                 </Button>
                 <Button v-else disabled class="w-full">
                   AI 换主题 · 暂不可用
                 </Button>
                 <p v-if="item.actions?.theme === 'unavailable'" class="text-center text-xs text-muted-foreground">
                   需登录并确认积分消耗后使用
                </p></CardContent
              ></Card
            >
            <Card
              ><CardHeader
                ><CardTitle class="text-base"
                  >方案配套资料</CardTitle
                ></CardHeader
              ><CardContent class="space-y-3">
                <Button
                  class="w-full justify-start gap-2"
                  variant="outline"
                  :disabled="preview"
                  @click="toggleBom"
                >
                  <FileText class="size-4" />
                  {{ showBom ? "收起物料清单" : "查看物料清单" }}
                </Button>
                <template v-if="showBom">
                  <div
                    class="rounded-lg border bg-card text-card-foreground shadow-sm"
                  >
                    <div class="p-4 pt-0 mt-4">
                      <!-- 加载中 -->
                      <div
                        v-if="bomLoading"
                        class="py-8 text-center text-sm text-muted-foreground"
                      >
                        加载中…
                      </div>
                      <!-- 修订变化提示 -->
                      <div v-else-if="bomRevisionChanged" class="space-y-3">
                        <p class="text-sm text-amber-600">
                          清单已更新，请刷新后重新下载。
                        </p>
                        <Button size="sm" variant="outline" @click="fetchBom"
                          >刷新清单</Button
                        >
                      </div>
                      <!-- 加载失败 -->
                      <div v-else-if="bomError" class="space-y-3">
                        <p class="text-sm text-destructive">加载失败</p>
                        <Button size="sm" variant="outline" @click="fetchBom"
                          >重试</Button
                        >
                      </div>
                      <!-- 清单不可用 -->
                      <div
                        v-else-if="!bomData"
                        class="py-4 text-sm text-muted-foreground"
                      >
                        当前方案暂无可用清单
                      </div>
                      <!-- 清单内容 -->
                      <div v-else class="space-y-4">
                        <div class="flex items-center justify-between">
                          <span class="text-xs text-muted-foreground"
                            >共 {{ bomData.items.length }} 条 · 修订
                            {{ bomData.revision }}</span
                          >
                          <Button
                            size="sm"
                            variant="outline"
                            @click="handleBomDownload"
                            :loading="bomDownloading"
                            :disabled="bomDownloading"
                          >
                            <FileText class="mr-1 size-3" />下载 XLSX
                          </Button>
                        </div>
                        <!-- 条目表格（最多显示20条，前端分页） -->
                        <div class="overflow-x-auto">
                          <table class="w-full text-xs">
                            <thead>
                              <tr
                                class="border-b text-left text-muted-foreground"
                              >
                                <th class="pb-2 pr-2 font-medium">#</th>
                                <th class="pb-2 pr-2 font-medium">名称</th>
                                <th class="pb-2 pr-2 font-medium">型号</th>
                                <th class="pb-2 pr-2 font-medium">规格(mm)</th>
                                 <th class="pb-2 pr-2 font-medium">数量</th>
                                 <th class="pb-2 pr-2 font-medium">重量合计/kg</th>
                                 <th class="pb-2 font-medium">ERP</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr
                                v-for="item in bomData.items.slice(0, 50)"
                                :key="item.id"
                                class="border-b last:border-0"
                              >
                                <td class="py-1.5 pr-2 tabular-nums">
                                  {{ item.ordinal }}
                                </td>
                                <td class="py-1.5 pr-2 max-w-32 truncate">
                                  {{ item.productName }}
                                </td>
                                <td class="py-1.5 pr-2 font-mono text-xs">
                                  {{ item.productModel ?? "—" }}
                                </td>
                                <td class="py-1.5 pr-2">
                                  {{ item.specificationMm ?? "—" }}
                                </td>
                                <td class="py-1.5 pr-2 tabular-nums">
                                  {{ item.quantity }}
                                   <span class="text-muted-foreground">{{
                                     item.measurementKind === 'length' ? 'm' : item.measurementKind === 'area' ? 'm²' : item.sourceUnit
                                   }}</span>
                                 </td>
                                 <td class="py-1.5 pr-2 tabular-nums">{{ item.totalWeightKg ?? "—" }}</td>
                                 <td class="py-1.5 font-mono text-xs">
                                  {{ item.erpCode ?? "—" }}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p
                          v-if="bomData.items.length > 50"
                          class="text-xs text-muted-foreground"
                        >
                          显示前 50 条，下载 XLSX 获取完整清单
                        </p>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-for="resource in resources" :key="resource.type">
                  <Button
                    variant="outline"
                    class="w-full justify-start gap-2"
                    :disabled="preview || !item.resources[resource.available]"
                    @click="toggleResource(resource.type)"
                  ><component :is="resource.icon" class="size-4" />{{ resource.label }}
                    <span class="ml-auto text-xs">{{ preview ? '示例' : !item.resources[resource.available] ? '暂无资料' : activeResource === resource.type ? '收起' : '查看' }}</span>
                  </Button>
                  <div v-if="activeResource === resource.type" class="space-y-2 rounded-lg border p-3 text-sm">
                    <p v-if="resourceLoading" class="text-muted-foreground">加载中…</p>
                    <template v-else>
                      <p v-if="resourceError" class="text-destructive">{{ resourceError }}</p>
                      <Button v-if="resourceError" size="sm" variant="outline" @click="fetchResource(resource.type)">重试</Button>
                      <p v-else-if="!resourceItems.length" class="text-muted-foreground">暂无可用资料</p>
                      <template v-else>
                        <div v-for="asset in resourceItems" :key="asset.assetId" class="space-y-2 border-b py-2 last:border-0">
                          <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0"><p class="truncate font-medium" :title="asset.name">{{ asset.name }}</p>
                              <p class="truncate text-xs text-muted-foreground" :title="asset.originalFilename">{{ asset.originalFilename }}</p></div>
                            <div class="flex shrink-0 gap-1">
                              <Button v-if="asset.mimeType.startsWith('image/') || asset.mimeType === 'application/pdf'" size="sm" variant="outline" :disabled="!!previewLoading" @click="showResourcePreview(resource.type, asset)">{{ previewAsset?.assetId === asset.assetId ? '收起' : '预览' }}</Button>
                              <Button size="sm" variant="outline" :disabled="!!downloadingAsset" @click="downloadResource(resource.type, asset.assetId)">下载</Button>
                            </div>
                          </div>
                          <template v-if="previewAsset?.assetId === asset.assetId">
                            <img v-if="previewAsset.mimeType.startsWith('image/')" :src="previewAsset.url" :alt="asset.name" class="w-full rounded-md border object-contain" />
                            <iframe v-else-if="previewAsset.mimeType === 'application/pdf'" :src="previewAsset.url" :title="asset.name" class="h-96 w-full rounded-md border" />
                          </template>
                        </div>
                      </template>
                    </template>
                  </div>
                </template>
                <Button variant="outline" class="w-full justify-start gap-2" :disabled="preview || !item.resources.model || !!downloadingAsset" @click="downloadResource('model')">
                  <Box class="size-4" />SKP 模型<span class="ml-auto text-xs">{{ preview ? '示例' : item.resources.model ? '下载' : '暂无资料' }}</span>
                </Button>
                <p v-if="downloadError" class="text-xs text-destructive">{{ downloadError }}</p>
                <p class="text-xs leading-relaxed text-muted-foreground">
                  资料取自当前已发布方案，具体项目施工资料需另行确认。
                </p></CardContent
              ></Card
            ><Button v-if="!preview" as-child class="w-full">
              <RouterLink :to="{ path: `/schemes/${encodeURIComponent(item.code)}/quote`, query: { entryPoint: showBom ? 'bill_of_materials' : 'scheme_detail', ...(bomData ? { bomRevision: String(bomData.revision) } : {}) } }">申请报价</RouterLink>
            </Button><Button v-else disabled variant="outline" class="w-full">示例方案不可申请报价</Button>
            <p class="text-xs leading-relaxed text-muted-foreground">
              参考方案的差异需经专业确认后，才能进入项目施工交付。
            </p>
          </aside>
        </div></template
      ><Card v-else
        ><CardContent
          class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"
          ><Box class="size-8 text-muted-foreground" />
          <h1 class="text-xl font-medium">
            {{
              preview
                ? "未找到该示例"
                : errorState
                  ? "方案详情加载失败"
                  : "加载中..."
            }}
          </h1>
          <p class="text-sm text-muted-foreground">
            {{
              preview
                ? "请从静态预览方案卡片进入。"
                : errorState
                  ? "公开详情将读取最新已发布数据，该方案可能已下架或不存在。"
                  : "正在获取最新方案详情。"
            }}
          </p>
          <Button v-if="errorState || preview" as-child
            ><RouterLink to="/ai-selection">返回选型</RouterLink></Button
          ></CardContent
        ></Card
      >
    </main></SelectionShell
  >
</template>
