<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { appLocale } from '@/plugins/i18n'
import { History, Search, ArrowRight, Image, Loader2, Palette, PanelsTopLeft, ChevronDown } from 'lucide-vue-next'
import StatusBadge from '@/components/StatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import { Pagination, PaginationList, PaginationPrev, PaginationNext } from '@/components/ui/pagination'
import MainLayout from '@/layouts/MainLayout.vue'
import { generationText, getJobStatusLabels, requirementSummary, summarizeGeneration } from '@/features/searches/summary'
import { useAuthStore } from '@/stores/auth'
import { getMySearches, type SearchPage, type SearchTheme, type SearchArtwork } from '@/services/api/searches'
import { getDirectionLabels } from '@/features/artwork-jobs/labels'

const { t } = useI18n()
const directionLabels = computed(() => getDirectionLabels(t))
const jobStatusLabels = computed(() => getJobStatusLabels(t))
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

const formatDate = (isoStr: string) => new Date(isoStr).toLocaleString(appLocale.value === 'zh' ? 'zh-CN' : appLocale.value)
function getJobLabel(job: SearchTheme | SearchArtwork) {
  if ('deliveryStatus' in job && job.deliveryStatus === 'ready') return t('searches.artworkComplete')
  return jobStatusLabels.value[job.status]
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
    error.value = t('searches.loadError')
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
  if (matchType === 'direct') return t('searches.matchDirect')
  if (matchType === 'reference') return t('searches.matchReference')
  return t('searches.matchRandom')
}

const detailLink = (code: string, searchId: string) => ({ path: `/schemes/${encodeURIComponent(code)}`, query: { searchId } })

onMounted(() => load())
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm text-primary flex items-center gap-2"><History class="w-4 h-4" /> {{ t('searches.pageTitle') }}</p>
          <h1 class="studio-title">{{ t('searches.pageDesc') }}</h1>
          <p class="text-sm text-muted-foreground">{{ t('searches.pageNote') }}</p>
        </div>
        <Button as-child>
          <RouterLink to="/ai-selection">{{ t('searches.reSearch') }}<ArrowRight class="ml-2 size-4" /></RouterLink>
        </Button>
      </header>

      <Card v-if="!authStore.isLoggedIn">
        <CardContent class="space-y-4 p-8">
          <History class="size-8 text-primary" />
          <p>{{ t('searches.loginPrompt') }}</p>
          <Button @click="login">{{ t('searches.loginBtn') }}</Button>
        </CardContent>
      </Card>

      <template v-else>
        <div v-if="loading && !list" role="status" class="flex items-center gap-3 p-6">
          <Loader2 class="size-5 animate-spin" />{{ t('searches.loading') }}
        </div>

        <Card v-if="error" role="alert">
          <CardContent class="space-y-3 p-6">
            <p class="text-destructive">{{ error }}</p>
            <Button variant="outline" @click="load()">{{ t('searches.reload') }}</Button>
          </CardContent>
        </Card>

        <template v-if="list && !error">
          <Card v-if="!list.items.length">
            <CardContent class="flex flex-col items-center justify-center gap-4 p-12 text-center text-muted-foreground">
              <Search class="size-12 opacity-50" />
              <div class="space-y-1">
                <h2 class="text-lg font-medium text-foreground">{{ t('searches.empty') }}</h2>
                <p class="text-sm">{{ t('searches.emptyDesc') }}</p>
              </div>
              <Button as-child class="mt-4">
                <RouterLink to="/ai-selection">{{ t('searches.startSearch') }}</RouterLink>
              </Button>
            </CardContent>
          </Card>

          <div v-else class="space-y-4">
            <Card v-for="record in list.items" :key="record.id" :data-record="record.id" class="shadow-sm">
              <CardContent class="space-y-4 p-4 sm:p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge v-for="chip in requirementSummary(record.finalRequirement, t)" :key="chip" variant="outline">{{ chip }}</Badge>
                      <span v-if="!requirementSummary(record.finalRequirement, t).length" class="text-sm text-muted-foreground">{{ t('searches.noSize') }}</span>
                    </div>
                    <p v-if="record.inputText" class="line-clamp-2 break-words text-sm text-muted-foreground">“{{ record.inputText }}”</p>
                  </div>
                  <div class="space-y-1 text-xs text-muted-foreground sm:text-right">
                    <p><time :datetime="record.createdAt">{{ formatDate(record.createdAt) }}</time></p>
                    <p>{{ t('searches.resultCount', { direct: record.counts.direct, reference: record.counts.reference }) }}</p>
                  </div>
                </div>

                <div v-if="record.items.length" class="flex flex-wrap items-center gap-3">
                  <RouterLink
                    v-for="item in record.items.slice(0, thumbnailLimit)" :key="item.code" :to="detailLink(item.code, record.id)"
                    :aria-label="t('searches.viewSchemeAriaLabel', { code: item.code })"
                    class="relative block aspect-video w-28 md:w-40 shrink-0 overflow-hidden rounded-md border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img v-if="item.thumbnail" :src="item.thumbnail" :alt="item.code" class="h-full w-full object-contain" loading="lazy" />
                    <Image v-else class="absolute inset-0 m-auto size-5 opacity-40" aria-hidden="true" />
                    <span v-if="item.theme || item.artwork" class="absolute bottom-1 right-1 flex gap-1 rounded bg-background/90 px-1 py-0.5 text-primary">
                      <Palette v-if="item.theme" class="size-3" aria-hidden="true" /><span v-if="item.theme" class="sr-only">{{ t('searches.hasTheme') }}</span>
                      <PanelsTopLeft v-if="item.artwork" class="size-3" aria-hidden="true" /><span v-if="item.artwork" class="sr-only">{{ t('searches.hasArtwork') }}</span>
                    </span>
                  </RouterLink>
                  <span v-if="record.items.length > thumbnailLimit" class="text-sm text-muted-foreground">{{ t('searches.moreSchemes', { count: record.items.length - thumbnailLimit }) }}</span>
                </div>
                <p v-else class="text-sm text-muted-foreground">{{ t('searches.noSchemes') }}</p>

                <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <p class="text-sm text-muted-foreground">{{ generationText(summarizeGeneration(record.items), t) }}</p>
                  <Button v-if="record.items.length" variant="ghost" size="sm" class="gap-1" :aria-expanded="!!expanded[record.id]" :aria-controls="`record-${record.id}`" @click="toggle(record.id)">
                    {{ expanded[record.id] ? t('searches.collapseResults') : t('searches.expandResults', { count: record.items.length }) }}
                    <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expanded[record.id] }" aria-hidden="true" />
                  </Button>
                </div>

                <ul v-if="expanded[record.id]" :id="`record-${record.id}`" class="divide-y rounded-lg border">
                  <li v-for="item in record.items" :key="item.code" class="grid gap-3 p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-5">
                    <div class="flex min-w-0 gap-3">
                      <Button v-if="item.thumbnail" variant="ghost" class="aspect-video w-28 shrink-0 overflow-hidden rounded-md border bg-muted/40 p-0 hover:bg-muted/60" :aria-label="t('searches.enlargeOriginalAriaLabel', { code: item.code })" @click="expandedImage = { url: item.thumbnail, label: `${item.code} · ${t('searches.originalImageTitle')}` }">
                        <img :src="item.thumbnail" :alt="item.code" class="h-full w-full object-contain" loading="lazy" />
                      </Button>
                      <span v-else class="flex aspect-video w-28 md:w-40 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground" role="img" :aria-label="`${item.code} ${t('searches.noOriginalImage')}`"><Image class="size-5 opacity-50" /></span>
                      <div class="min-w-0 space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-mono text-sm font-medium">{{ item.code }}</span>
                          <Badge :variant="getMatchVariant(item.matchType)">{{ getMatchLabel(item.matchType) }}</Badge>
                        </div>
                        <p class="text-xs text-muted-foreground">
                          {{ item.specifications.lengthMm / 1000 }} × {{ item.specifications.widthMm / 1000 }} m · {{ item.specifications.areaM2 }} ㎡ · {{ t('searches.heightLabel', { value: item.specifications.heightMm / 1000 }) }}
                        </p>
                        <RouterLink :to="detailLink(item.code, record.id)" class="inline-flex items-center gap-1 text-xs text-primary hover:underline">{{ t('searches.viewScheme') }}<ArrowRight class="size-3" aria-hidden="true" /></RouterLink>
                      </div>
                    </div>

                    <div class="min-w-0 space-y-2 text-sm">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="flex items-center gap-1.5 font-medium"><Palette class="size-4 text-primary" aria-hidden="true" />{{ t('searches.themeTitle') }}</span>
                        <StatusBadge v-if="item.theme" domain="job" :status="item.theme.status" :label="getJobLabel(item.theme)" />
                        <span v-else class="text-xs text-muted-foreground">{{ t('searches.noTheme') }}</span>
                      </div>
                      <div v-if="item.theme" class="flex flex-wrap items-center gap-3">
                        <Button v-if="item.theme.previewUrl" variant="ghost" class="aspect-video w-20 md:w-28 overflow-hidden rounded-md border bg-muted/40 p-0 hover:bg-muted/60" :aria-label="t('searches.enlargeThemeAriaLabel', { code: item.code })" @click="expandedImage = { url: item.theme.previewUrl, label: `${item.code} · ${t('searches.themeTitle')}` }">
                          <img :src="item.theme.previewUrl" :alt="t('searches.themeResultAlt')" class="h-full w-full object-contain" loading="lazy" />
                        </Button>
                        <div class="space-y-1 text-xs text-muted-foreground">
                          <p>{{ formatDate(item.theme.createdAt) }}</p>
                          <RouterLink :to="`/theme-jobs/${encodeURIComponent(item.theme.jobId)}`" :aria-label="t('searches.viewThemeTask', { code: item.code })" class="inline-flex items-center gap-1 text-primary hover:underline">{{ t('searches.viewTask') }}<ArrowRight class="size-3" aria-hidden="true" /></RouterLink>
                        </div>
                      </div>
                    </div>

                    <div class="min-w-0 space-y-2 text-sm">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="flex items-center gap-1.5 font-medium"><PanelsTopLeft class="size-4 text-primary" aria-hidden="true" />{{ t('searches.artworkTitle') }}</span>
                        <StatusBadge v-if="item.artwork" domain="job" :status="item.artwork.status" :label="getJobLabel(item.artwork)" />
                        <span v-else class="text-xs text-muted-foreground">{{ t('searches.noArtwork') }}</span>
                      </div>
                      <div v-if="item.artwork" class="space-y-2">
                        <div v-if="item.artwork.views.length" class="flex flex-wrap gap-2">
                          <Button v-for="view in item.artwork.views" :key="view.direction" variant="ghost" class="h-auto w-20 md:w-28 flex-col gap-1 p-0 hover:bg-transparent" :aria-label="t('searches.enlargeArtworkAriaLabel', { code: item.code, dir: directionLabels[view.direction] })" @click="expandedImage = { url: view.previewUrl, label: `${item.code} · ${directionLabels[view.direction]} · ${t('searches.artworkTitle')}` }">
                            <img :src="view.previewUrl" :alt="`${item.code} · ${directionLabels[view.direction]} · ${t('searches.artworkTitle')}`" class="aspect-video w-full rounded-md border bg-muted/40 object-contain" loading="lazy" />
                            <span class="text-xs font-normal text-muted-foreground">{{ directionLabels[view.direction] }}</span>
                          </Button>
                        </div>
                        <div class="space-y-1 text-xs text-muted-foreground">
                          <p>{{ formatDate(item.artwork.createdAt) }}</p>
                          <RouterLink :to="`/artwork-jobs/${encodeURIComponent(item.artwork.jobId)}`" :aria-label="t('searches.viewArtworkTask', { code: item.code })" class="inline-flex items-center gap-1 text-primary hover:underline">{{ t('searches.viewTask') }}<ArrowRight class="size-3" aria-hidden="true" /></RouterLink>
                        </div>
                      </div>
                    </div>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted-foreground">{{ t('searches.totalCount', { total: list.total, page: page }) }}</span>
              <Pagination :page="page" :total="list.total" :items-per-page="pageSize" :disabled="loading" @update:page="load">
                <PaginationList class="flex gap-2">
                  <PaginationPrev class="w-auto px-3" :aria-label="t('common.previousPage')">{{ t('common.previousPage') }}</PaginationPrev>
                  <PaginationNext class="w-auto px-3" :aria-label="t('common.nextPage')">{{ t('common.nextPage') }}</PaginationNext>
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
      :description="t('searches.galleryAriaLabel')"
      @update:open="value => { if (!value) expandedImage = undefined }"
    />
  </MainLayout>
</template>
