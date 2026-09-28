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
import {
  getClientBomApi,
  downloadClientBomApi,
  type ClientBomResponse,
} from "@/services/api/bom";

const route = useRoute();
const preview = computed(() => route.path.startsWith("/ai-selection/preview/"));
const liveData = ref<SchemeDetail | null>(null);
const errorState = ref(false);

const bomData = ref<ClientBomResponse | null>(null);
const bomLoading = ref(false);
const bomDownloading = ref(false);
const bomError = ref(false);
const bomRevisionChanged = ref(false);
const showBom = ref(false);

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
        if (err?.error?.code === 'AUTH_REQUIRED' || response.status === 401) {
          // 401 跳登录——手动处理，因为绕开了 apiFetch 拦截器
          const { useRouter } = await import('vue-router');
          const router = useRouter();
          await router.push('/auth/sign-in');
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
    } else if (e?.response?.status !== 401) {
      // 401 已由 apiFetch 自动处理（跳转登录）
      alert('下载失败，请重试');
    }
  } finally {
    bomDownloading.value = false;
  }
}

function toggleBom() {
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
        theme: "unavailable",
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
  { label: "三视图", icon: Layers3 },
  { label: "平面素材", icon: Image },
  { label: "SKP 模型", icon: Box },
];

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
                ><Button disabled class="w-full">AI 换主题 · 待接入</Button>
                <p class="text-center text-xs text-muted-foreground">
                  需登录后使用
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

                <Button
                  v-for="resource in resources"
                  :key="resource.label"
                  disabled
                  variant="outline"
                  class="w-full justify-start gap-2"
                  ><component :is="resource.icon" class="size-4" />{{
                    resource.label
                  }}<span class="ml-auto text-xs">待接入</span></Button
                >
                <p class="text-xs leading-relaxed text-muted-foreground">
                  资料按账户权限获取，模型仅向授权合作伙伴开放。
                </p></CardContent
              ></Card
            ><Button disabled variant="outline" class="w-full"
              >申请报价 · 待接入</Button
            >
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
