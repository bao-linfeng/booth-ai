<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { History, Search, ArrowRight, Image, Loader2, Palette, PanelsTopLeft, ChevronDown } from 'lucide-vue-next'
import StatusBadge from '@/components/StatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import { Pagination, PaginationList, PaginationPrev, PaginationNext } from '@/components/ui/pagination'
import MainLayout from '@/layouts/MainLayout.vue'
import { generationText, jobStatusLabels, requirementSummary, summarizeGeneration } from '@/features/searches/summary'
import { useAuthStore } from '@/stores/auth'
import { getMySearches, type SearchPage, type SearchTheme, type SearchArtwork } from '@/services/api/searches'
import { directionLabels } from '@/features/artwork-jobs/labels'

const router = useRouter()
const authStore = useAuthStore()

const pageSize = 20
const thumbnailLimit = 4
const loading = ref(false)
const error = ref('')
const page = ref(1)
const list = ref<SearchPage>()
const expanded = ref<Record<string, boolean>>({})
const expandedImage = ref<{ url: string; label: string }>()

const formatDate = (isoStr: string) => new Date(isoStr).toLocaleString('zh-CN')
function getJobLabel(job: SearchTheme | SearchArtwork) {
  if ('deliveryStatus' in job && job.deliveryStatus === 'ready') return '四面齐全'
  return jobStatusLabels[job.status]
}

async function load(next = page.value) {
  if (!authStore.isLoggedIn) return
  loading.value = true
  error.value = ''
  page.value = next
  try {
    list.value = await getMySearches({ page: next, pageSize })
    expanded.value = {}
  } catch (failure: unknown) {
    error.value = '加载失败，请重试。'
  } finally {
    loading.value = false
  }
}

function login() {
  void router.push({ path: '/auth/sign-in', query: { redirect: '/my-searches' } })
}

function toggle(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

function getMatchVariant(matchType: string) {
  if (matchType === 'direct') return 'default'
  if (matchType === 'reference') return 'secondary'
  return 'outline'
}

function getMatchLabel(matchType: string) {
  if (matchType === 'direct') return '可直接采用'
  if (matchType === 'reference') return '参考方案'
  return '随机推荐'
}

const detailLink = (code: string, searchId: string) => ({ path: `/schemes/${encodeURIComponent(code)}`, query: { searchId } })

onMounted(() => load())
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm text-primary flex items-center gap-2"><History class="w-4 h-4" /> 检索记录</p>
          <h1 class="studio-title">每次 AI 智选的检索结果</h1>
          <p class="text-sm text-muted-foreground">查看匹配方案、AI 换主题与四面素材的生成进度，展开记录可直接进入对应任务。</p>
        </div>
        <Button as-child>
          <RouterLink to="/ai-selection">重新检索<ArrowRight class="ml-2 size-4" /></RouterLink>
        </Button>
      </header>

      <Card v-if="!authStore.isLoggedIn">
        <CardContent class="space-y-4 p-8">
          <History class="size-8 text-primary" />
          <p>登录后更安全地管理您的检索记录。</p>
          <Button @click="login">去登录</Button>
        </CardContent>
      </Card>

      <template v-else>
        <div v-if="loading && !list" role="status" class="flex items-center gap-3 p-6">
          <Loader2 class="size-5 animate-spin" />正在读取记录…
        </div>

        <Card v-if="error" role="alert">
          <CardContent class="space-y-3 p-6">
            <p class="text-destructive">{{ error }}</p>
            <Button variant="outline" @click="load()">重新加载</Button>
          </CardContent>
        </Card>

        <template v-if="list && !error">
          <Card v-if="!list.items.length">
            <CardContent class="flex flex-col items-center justify-center gap-4 p-12 text-center text-muted-foreground">
              <Search class="size-12 opacity-50" />
              <div class="space-y-1">
                <h2 class="text-lg font-medium text-foreground">暂无检索记录</h2>
                <p class="text-sm">您还没有使用 AI 智选查找过方案。</p>
              </div>
              <Button as-child class="mt-4">
                <RouterLink to="/ai-selection">开始选方案</RouterLink>
              </Button>
            </CardContent>
          </Card>

          <div v-else class="space-y-4">
            <Card v-for="record in list.items" :key="record.id" :data-record="record.id" class="shadow-sm">
              <CardContent class="space-y-4 p-4 sm:p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge v-for="chip in requirementSummary(record.finalRequirement)" :key="chip" variant="outline">{{ chip }}</Badge>
                      <span v-if="!requirementSummary(record.finalRequirement).length" class="text-sm text-muted-foreground">未填写尺寸条件</span>
                    </div>
                    <p v-if="record.inputText" class="line-clamp-2 break-words text-sm text-muted-foreground">“{{ record.inputText }}”</p>
                  </div>
                  <div class="space-y-1 text-xs text-muted-foreground sm:text-right">
                    <p><time :datetime="record.createdAt">{{ formatDate(record.createdAt) }}</time></p>
                    <p>{{ record.counts.direct }} 套直接采用 · {{ record.counts.reference }} 套参考</p>
                  </div>
                </div>

                <div v-if="record.items.length" class="flex flex-wrap items-center gap-3">
                  <RouterLink
                    v-for="item in record.items.slice(0, thumbnailLimit)" :key="item.code" :to="detailLink(item.code, record.id)"
                    :aria-label="`查看方案 ${item.code}`"
                    class="relative block aspect-video w-28 md:w-40 shrink-0 overflow-hidden rounded-md border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img v-if="item.thumbnail" :src="item.thumbnail" :alt="item.code" class="h-full w-full object-contain" loading="lazy" />
                    <Image v-else class="absolute inset-0 m-auto size-5 opacity-40" aria-hidden="true" />
                    <span v-if="item.theme || item.artwork" class="absolute bottom-1 right-1 flex gap-1 rounded bg-background/90 px-1 py-0.5 text-primary">
                      <Palette v-if="item.theme" class="size-3" aria-hidden="true" /><span v-if="item.theme" class="sr-only">已换主题</span>
                      <PanelsTopLeft v-if="item.artwork" class="size-3" aria-hidden="true" /><span v-if="item.artwork" class="sr-only">已有四面素材</span>
                    </span>
                  </RouterLink>
                  <span v-if="record.items.length > thumbnailLimit" class="text-sm text-muted-foreground">另有 {{ record.items.length - thumbnailLimit }} 套</span>
                </div>
                <p v-else class="text-sm text-muted-foreground">本次检索没有可展示的方案。</p>

                <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <p class="text-sm text-muted-foreground">{{ generationText(summarizeGeneration(record.items)) }}</p>
                  <Button v-if="record.items.length" variant="ghost" size="sm" class="gap-1" :aria-expanded="!!expanded[record.id]" :aria-controls="`record-${record.id}`" @click="toggle(record.id)">
                    {{ expanded[record.id] ? '收起成果' : `查看 ${record.items.length} 套方案的成果` }}
                    <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expanded[record.id] }" aria-hidden="true" />
                  </Button>
                </div>

                <ul v-if="expanded[record.id]" :id="`record-${record.id}`" class="divide-y rounded-lg border">
                  <li v-for="item in record.items" :key="item.code" class="grid gap-3 p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-5">
                    <div class="flex min-w-0 gap-3">
                      <Button v-if="item.thumbnail" variant="ghost" class="aspect-video w-28 shrink-0 overflow-hidden rounded-md border bg-muted/40 p-0 hover:bg-muted/60" :aria-label="`放大 ${item.code} 原始方案`" @click="expandedImage = { url: item.thumbnail, label: `${item.code} · 原始方案` }">
                        <img :src="item.thumbnail" :alt="item.code" class="h-full w-full object-contain" loading="lazy" />
                      </Button>
                      <span v-else class="flex aspect-video w-28 md:w-40 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground" role="img" :aria-label="`${item.code} 暂无原始方案图片`"><Image class="size-5 opacity-50" /></span>
                      <div class="min-w-0 space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-mono text-sm font-medium">{{ item.code }}</span>
                          <Badge :variant="getMatchVariant(item.matchType)">{{ getMatchLabel(item.matchType) }}</Badge>
                        </div>
                        <p class="text-xs text-muted-foreground">
                          {{ item.specifications.lengthMm / 1000 }} × {{ item.specifications.widthMm / 1000 }} m · {{ item.specifications.areaM2 }} ㎡ · 高 {{ item.specifications.heightMm / 1000 }} m
                        </p>
                        <RouterLink :to="detailLink(item.code, record.id)" class="inline-flex items-center gap-1 text-xs text-primary hover:underline">查看方案<ArrowRight class="size-3" aria-hidden="true" /></RouterLink>
                      </div>
                    </div>

                    <div class="min-w-0 space-y-2 text-sm">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="flex items-center gap-1.5 font-medium"><Palette class="size-4 text-primary" aria-hidden="true" />AI 换主题</span>
                        <StatusBadge v-if="item.theme" domain="job" :status="item.theme.status" :label="getJobLabel(item.theme)" />
                        <span v-else class="text-xs text-muted-foreground">未换主题</span>
                      </div>
                      <div v-if="item.theme" class="flex flex-wrap items-center gap-3">
                        <Button v-if="item.theme.previewUrl" variant="ghost" class="aspect-video w-20 md:w-28 overflow-hidden rounded-md border bg-muted/40 p-0 hover:bg-muted/60" :aria-label="`放大 ${item.code} AI 换主题效果`" @click="expandedImage = { url: item.theme.previewUrl, label: `${item.code} · AI 换主题` }">
                          <img :src="item.theme.previewUrl" :alt="`${item.code} 本次检索的换主题效果`" class="h-full w-full object-contain" loading="lazy" />
                        </Button>
                        <div class="space-y-1 text-xs text-muted-foreground">
                          <p>{{ formatDate(item.theme.createdAt) }}</p>
                          <RouterLink :to="`/theme-jobs/${encodeURIComponent(item.theme.jobId)}`" :aria-label="`查看 ${item.code} 换主题任务`" class="inline-flex items-center gap-1 text-primary hover:underline">查看任务<ArrowRight class="size-3" aria-hidden="true" /></RouterLink>
                        </div>
                      </div>
                    </div>

                    <div class="min-w-0 space-y-2 text-sm">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="flex items-center gap-1.5 font-medium"><PanelsTopLeft class="size-4 text-primary" aria-hidden="true" />四面素材</span>
                        <StatusBadge v-if="item.artwork" domain="job" :status="item.artwork.status" :label="getJobLabel(item.artwork)" />
                        <span v-else class="text-xs text-muted-foreground">未生成四面素材</span>
                      </div>
                      <div v-if="item.artwork" class="space-y-2">
                        <div v-if="item.artwork.views.length" class="flex flex-wrap gap-2">
                          <Button v-for="view in item.artwork.views" :key="view.direction" variant="ghost" class="h-auto w-20 md:w-28 flex-col gap-1 p-0 hover:bg-transparent" :aria-label="`放大 ${item.code} ${directionLabels[view.direction]}视图`" @click="expandedImage = { url: view.previewUrl, label: `${item.code} · ${directionLabels[view.direction]}视图` }">
                            <img :src="view.previewUrl" :alt="`${item.code} ${directionLabels[view.direction]}视图`" class="aspect-video w-full rounded-md border bg-muted/40 object-contain" loading="lazy" />
                            <span class="text-xs font-normal text-muted-foreground">{{ directionLabels[view.direction] }}</span>
                          </Button>
                        </div>
                        <div class="space-y-1 text-xs text-muted-foreground">
                          <p>{{ formatDate(item.artwork.createdAt) }}</p>
                          <RouterLink :to="`/artwork-jobs/${encodeURIComponent(item.artwork.jobId)}`" :aria-label="`查看 ${item.code} 四面素材任务`" class="inline-flex items-center gap-1 text-primary hover:underline">查看任务<ArrowRight class="size-3" aria-hidden="true" /></RouterLink>
                        </div>
                      </div>
                    </div>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted-foreground">共 {{ list.total }} 条记录 · 第 {{ page }} 页</span>
              <Pagination :page="page" :total="list.total" :items-per-page="pageSize" :disabled="loading" @update:page="load">
                <PaginationList class="flex gap-2">
                  <PaginationPrev class="w-auto px-3" aria-label="上一页">上一页</PaginationPrev>
                  <PaginationNext class="w-auto px-3" aria-label="下一页">下一页</PaginationNext>
                </PaginationList>
              </Pagination>
            </div>
          </div>
        </template>
      </template>
    </main>
    <ImagePreviewDialog
      :open="!!expandedImage"
      :src="expandedImage?.url"
      :alt="expandedImage?.label"
      :title="expandedImage?.label"
      description="本次检索中的方案与生成成果预览。"
      @update:open="value => { if (!value) expandedImage = undefined }"
    />
  </MainLayout>
</template>
