<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { History, Search, ArrowRight, Image, Loader2, Palette, PanelsTopLeft } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Pagination, PaginationList, PaginationPrev, PaginationNext } from '@/components/ui/pagination'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import { useAuthStore } from '@/stores/auth'
import { getMySearches, type SearchPage, type SearchTheme, type SearchArtwork } from '@/services/api/searches'
import { directionLabels, type Direction } from '@/services/api/artwork-jobs'
import type { Requirement } from '@/features/selection/types'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const error = ref('')
const page = ref(1)
const list = ref<SearchPage>()
const expandedImage = ref<{ url: string; label: string }>()
const directions: Direction[] = ['front', 'back', 'left', 'right']

const formatDate = (isoStr: string) => new Date(isoStr).toLocaleString('zh-CN')
const jobStatusLabels: Record<SearchTheme['status'], string> = {
  pending: '等待生成',
  queued: '排队中',
  running: '生成中',
  settling: '结算中',
  succeeded: '已完成',
  partially_succeeded: '部分完成',
  failed: '生成失败',
}

function getJobLabel(job: SearchTheme | SearchArtwork) {
  if ('deliveryStatus' in job && job.deliveryStatus === 'ready') return '四面齐全'
  return jobStatusLabels[job.status]
}

function artworkView(artwork: SearchArtwork | null, direction: Direction) {
  return artwork?.views.find(view => view.direction === direction)
}

function expandArtwork(code: string, artwork: SearchArtwork | null, direction: Direction) {
  const view = artworkView(artwork, direction)
  if (view) expandedImage.value = { url: view.previewUrl, label: `${code} · ${directionLabels[direction]}视图` }
}

async function load(next = page.value) {
  if (!authStore.isLoggedIn) return
  loading.value = true
  error.value = ''
  page.value = next
  try {
    list.value = await getMySearches({ page: next, pageSize: 20 })
  } catch (failure: unknown) {
    error.value = '加载失败，请重试。'
  } finally {
    loading.value = false
  }
}

function login() {
  void router.push({ path: '/auth/sign-in', query: { redirect: '/my-searches' } })
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

function generateChips(req: Requirement) {
  const chips: string[] = []
  if (req.lengthMm && req.widthMm) {
    chips.push(`${req.lengthMm / 1000}×${req.widthMm / 1000} m`)
  }
  if (req.areaM2) {
    chips.push(`${req.areaM2} ㎡`)
  }
  return chips
}

onMounted(() => load())
</script>

<template>
  <SelectionShell>
    <main class="container mx-auto max-w-7xl space-y-6 px-4 py-8">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm text-primary flex items-center gap-2"><History class="w-4 h-4" /> 检索记录</p>
          <h1 class="text-3xl font-semibold">每次 AI 智选的检索结果</h1>
          <p class="text-sm text-muted-foreground">查看匹配方案、AI 换主题与四面视图生成记录。</p>
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

          <div v-else class="space-y-6">
            <Card v-for="record in list.items" :key="record.id" class="relative overflow-hidden group">
              <CardHeader class="pb-3">
                <div class="flex flex-wrap items-center gap-3">
                  <CardTitle class="text-base">{{ formatDate(record.createdAt) }}</CardTitle>
                  <Badge variant="secondary">{{ record.counts.direct }} 套直接采用 · {{ record.counts.reference }} 套参考</Badge>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <Badge v-for="chip in generateChips(record.finalRequirement)" :key="chip" variant="outline">{{ chip }}</Badge>
                </div>
                <CardDescription v-if="record.inputText" class="mt-2">
                  "{{ record.inputText.length > 50 ? record.inputText.substring(0, 50) + '...' : record.inputText }}"
                </CardDescription>
              </CardHeader>
              
              <CardContent>
                <div class="space-y-6">
                  <Card v-for="item in record.items" :key="item.code" class="shadow-none">
                    <CardContent class="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
                      <section class="min-w-0 space-y-3">
                        <h3 class="text-sm font-medium">原始方案</h3>
                        <figure class="relative aspect-[4/3] rounded-lg bg-muted/40">
                          <Button v-if="item.thumbnail" variant="ghost" class="absolute inset-0 h-full w-full overflow-hidden rounded-lg p-0 hover:bg-muted/60" :aria-label="`放大 ${item.code} 原始方案`" @click="expandedImage = { url: item.thumbnail, label: `${item.code} · 原始方案` }">
                            <img :src="item.thumbnail" :alt="item.code" class="h-full w-full object-contain" loading="lazy" />
                          </Button>
                          <span v-else class="absolute inset-0 flex items-center justify-center text-muted-foreground" role="img" :aria-label="`${item.code} 暂无原始方案图片`">
                            <Image class="size-6 opacity-50" />
                          </span>
                          <Badge class="pointer-events-none absolute top-2 left-2 shadow-sm" :variant="getMatchVariant(item.matchType)">
                            {{ getMatchLabel(item.matchType) }}
                          </Badge>
                        </figure>

                        <div class="flex flex-col gap-2">
                          <span class="font-mono font-medium text-sm">{{ item.code }}</span>
                          <p class="text-xs text-muted-foreground">
                            {{ item.specifications.lengthMm / 1000 }} × {{ item.specifications.widthMm / 1000 }} m · {{ item.specifications.areaM2 }} ㎡ · 高 {{ item.specifications.heightMm / 1000 }} m
                          </p>

                          <div class="pt-2">
                            <Button variant="outline" size="sm" class="w-full justify-between" as-child>
                              <RouterLink :to="{ path: `/schemes/${encodeURIComponent(item.code)}`, query: { searchId: record.id } }">
                                查看详情<ArrowRight class="size-3" />
                              </RouterLink>
                            </Button>
                          </div>
                        </div>
                      </section>
                      <section class="min-w-0 space-y-3">
                        <div class="flex items-center justify-between gap-2">
                          <h3 class="flex items-center gap-2 text-sm font-medium"><Palette class="size-4 text-primary" />AI 换主题</h3>
                          <Badge v-if="item.theme" variant="secondary" class="text-xs">{{ getJobLabel(item.theme) }}</Badge>
                        </div>
                        <Button v-if="item.theme?.previewUrl" variant="ghost" class="block aspect-[4/3] h-auto w-full overflow-hidden rounded-lg bg-muted/40 p-0 hover:bg-muted/60" :aria-label="`放大 ${item.code} AI 换主题效果`" @click="expandedImage = { url: item.theme.previewUrl, label: `${item.code} · AI 换主题` }">
                          <img :src="item.theme.previewUrl" :alt="`${item.code} 本次检索的换主题效果`" class="h-full w-full object-contain" loading="lazy" />
                        </Button>
                        <Card v-else class="rounded-lg border-dashed shadow-none">
                          <CardContent class="flex aspect-[4/3] flex-col items-center justify-center gap-2 p-0 text-xs text-muted-foreground">
                            <Palette class="size-6 opacity-40" />{{ item.theme ? '本次任务暂无效果图' : '本次检索尚未换主题' }}
                          </CardContent>
                        </Card>
                        <p v-if="item.theme" class="text-xs text-muted-foreground">{{ formatDate(item.theme.createdAt) }}</p>
                      </section>
                      <section class="min-w-0 space-y-3">
                        <div class="flex items-center justify-between gap-2">
                          <h3 class="flex items-center gap-2 text-sm font-medium"><PanelsTopLeft class="size-4 text-primary" />四面视图</h3>
                          <Badge v-if="item.artwork" variant="secondary" class="text-xs">{{ getJobLabel(item.artwork) }}</Badge>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                          <figure v-for="direction in directions" :key="direction" class="min-w-0 space-y-1.5">
                            <Button v-if="artworkView(item.artwork, direction)" variant="ghost" class="block aspect-[3/2] h-auto w-full overflow-hidden rounded-lg bg-muted/40 p-0 hover:bg-muted/60" :aria-label="`放大 ${item.code} ${directionLabels[direction]}视图`" @click="expandArtwork(item.code, item.artwork, direction)">
                              <img :src="artworkView(item.artwork, direction)?.previewUrl" :alt="`${item.code} ${directionLabels[direction]}视图`" class="h-full w-full object-contain" loading="lazy" />
                            </Button>
                            <Card v-else class="rounded-lg border-dashed shadow-none">
                              <CardContent class="flex aspect-[3/2] items-center justify-center p-0 text-xs text-muted-foreground">{{ item.artwork ? '暂无图片' : '尚未生成' }}</CardContent>
                            </Card>
                            <figcaption class="text-center text-xs text-muted-foreground">{{ directionLabels[direction] }}</figcaption>
                          </figure>
                        </div>
                        <p v-if="item.artwork" class="text-xs text-muted-foreground">{{ formatDate(item.artwork.createdAt) }}</p>
                      </section>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
            
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted-foreground">共 {{ list.total }} 条记录 · 第 {{ page }} 页</span>
              <Pagination :page="page" :total="list.total" :items-per-page="20" :disabled="loading" @update:page="load">
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
    <Dialog :open="!!expandedImage" @update:open="value => { if (!value) expandedImage = undefined }">
      <DialogContent class="max-h-[90dvh] max-w-5xl overflow-y-auto">
        <DialogTitle>{{ expandedImage?.label }}</DialogTitle>
        <DialogDescription>本次检索对应的方案效果，点击图片可在当前页放大查看。</DialogDescription>
        <img v-if="expandedImage" :src="expandedImage.url" :alt="expandedImage.label" class="max-h-[75dvh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  </SelectionShell>
</template>
