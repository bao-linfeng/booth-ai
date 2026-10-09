<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { appLocale } from '@/plugins/i18n'
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Loader2, MessageCircle } from 'lucide-vue-next'
import { openWith as openCustomerService, setPageContext } from '@/features/customer-service/useCustomerService'
import StatusBadge from '@/components/StatusBadge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MainLayout from '@/layouts/MainLayout.vue'
import { getProjectStatusLabels, getScopeLabel } from '@/features/projects/labels'
import { closedStatuses, dateRange, getNextSteps, joinParts, regionName, summarizeRequirement } from '@/features/projects/summary'
import type { Catalog } from '@/features/selection/types'
import { useAuthStore } from '@/stores/auth'
import { getCatalogOptions } from '@/services/api/catalog'
import { getMyProject, getMyProjects, type MyProjectDetail, type ProjectPage } from '@/services/api/projects'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const pageSize = 10
const list = ref<ProjectPage>()
const detail = ref<MyProjectDetail>()
const catalog = ref<Catalog | null>(null)
const loading = ref(false)
const error = ref('')
const page = ref(1)
const filters = reactive({ projectNo: '', status: '', sourceType: '', exhibitionName: '' })

const date = (value: string) => new Date(value).toLocaleString(appLocale.value === 'zh' ? 'zh-CN' : appLocale.value)
const statusLabels = computed(() => getProjectStatusLabels(t))
const nextSteps = computed(() => getNextSteps(t))
const materialLabels = computed<Record<string, string>>(() => ({
  available: t('projects.materialAvailable'),
  pending: t('projects.materialPending'),
  missing: t('projects.materialMissing'),
}))
const materialTypeLabels = computed(() => ({
  bom: t('projects.materialBom'),
  drawings: t('projects.materialDrawings'),
  artworks: t('projects.materialArtworks'),
}))
const sourceLabels = computed(() => ({
  quote_request: t('projects.sourceQuoteRequest'),
  manual_request: t('projects.sourceManualRequest'),
}))
const exhibitionPlace = (exhibition: MyProjectDetail['request']['exhibition']) =>
  joinParts([regionName(exhibition?.countryCode, appLocale.value), exhibition?.city], ' / ')
const requirement = computed(() => summarizeRequirement(detail.value?.request.confirmedRequirements, catalog.value, t))
const contactLines = computed(() => {
  const contact = detail.value?.request.contact
  return [contact?.email, contact?.phone, contact?.legacyDetail].filter((line): line is string => !!line)
})
const canSupplementArtworks = computed(() => {
  const project = detail.value
  return !!project && !project.artworkJobId && !!project.selectedThemeSummary && !!project.schemeCode
    && project.materialsStatus.artworks === 'pending' && !closedStatuses.includes(project.status)
})

async function loadCatalog() {
  if (catalog.value) return
  try {
    catalog.value = await getCatalogOptions()
  } catch {
    // 名称映射失败时只展示尺寸等无需映射的条件，不输出原始 ID。
  }
}

// 每次加载递增：只有最新一次请求能写入详情、列表、错误与 loading，切换项目、翻页、换账号或离开页面后旧响应作废
let loadSeq = 0
async function load(next = page.value) {
  const current = ++loadSeq
  if (!auth.isLoggedIn) { loading.value = false; return }
  loading.value = true
  error.value = ''
  page.value = next
  const projectId = route.params.projectId ? String(route.params.projectId) : null
  try {
    if (projectId) {
      const project = await getMyProject(projectId)
      if (current !== loadSeq) return
      detail.value = project
      if (project.request.confirmedRequirements) void loadCatalog()
    } else {
      const projects = await getMyProjects({ ...filters, page: next, pageSize })
      if (current === loadSeq) list.value = projects
    }
  } catch (failure: unknown) {
    if (current !== loadSeq) return
    const status = (failure as { response?: { status?: number } }).response?.status
    error.value = status === 404 ? t('projects.errorNotExist') : t('projects.errorLoadFailed')
  } finally {
    if (current === loadSeq) loading.value = false
  }
}
function reset() { detail.value = undefined; list.value = undefined; error.value = '' }
function login() { void router.push({ path: '/auth/sign-in', query: { redirect: route.fullPath } }) }
onMounted(() => load())
watch(() => route.params.projectId, () => { reset(); void load(1) })
// 退出或切换账号：清掉上一账号的数据，按当前身份重新读取；已登录会话只是补齐用户资料（'' → id）时不算换账号
watch(() => (auth.isLoggedIn ? auth.currentUser?.id ?? '' : null), (id, previous) => {
  if (previous === '' && id) return
  reset(); void load(1)
})
// 客服输入框的“发送当前项目”：只在项目详情加载成功后登记，回到列表或离开页面时清除
watch(() => (route.params.projectId && !error.value ? detail.value : undefined), (project) => {
  setPageContext(project ? { context: { kind: 'project', projectId: project.projectId }, entryPoint: 'my_project', label: project.projectNo } : null)
}, { immediate: true })
onBeforeUnmount(() => { loadSeq++; setPageContext(null) })
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm text-primary">{{ t('projects.pageTitle') }}</p>
          <h1 class="studio-title">{{ route.params.projectId ? t('projects.detailTitle') : t('projects.listTitle') }}</h1>
          <p class="text-sm text-muted-foreground">{{ t('projects.pageDesc') }}</p>
        </div>
        <Button variant="outline" as-child>
          <RouterLink :to="route.params.projectId ? '/my-projects' : '/ai-selection'"><ArrowLeft class="mr-2 size-4" />{{ route.params.projectId ? t('projects.backToList') : t('projects.backToSelection') }}</RouterLink>
        </Button>
      </header>

      <Card v-if="!auth.isLoggedIn">
        <CardContent class="space-y-4 p-8">
          <BriefcaseBusiness class="size-8 text-primary" />
          <p>{{ t('projects.loginPrompt') }}</p>
          <Button @click="login">{{ t('projects.loginAndReturn') }}</Button>
        </CardContent>
      </Card>

      <template v-else>
        <form v-if="!route.params.projectId" class="grid items-end gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-5" @submit.prevent="load(1)">
          <div class="space-y-2"><Label for="project-number">{{ t('projects.filterProjectId') }}</Label><Input id="project-number" v-model="filters.projectNo" maxlength="200" /></div>
          <div class="space-y-2"><Label for="exhibition-filter">{{ t('projects.filterName') }}</Label><Input id="exhibition-filter" v-model="filters.exhibitionName" maxlength="200" /></div>
          <div class="space-y-2">
            <Label>{{ t('projects.filterStatus') }}</Label>
            <Select :model-value="filters.status || '__all'" @update:model-value="filters.status = $event === '__all' ? '' : String($event)">
              <SelectTrigger :aria-label="t('projects.filterStatus')"><SelectValue :placeholder="t('projects.filterStatusAll')" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{{ t('projects.filterStatusAll') }}</SelectItem>
                <SelectItem v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2">
            <Label>{{ t('projects.filterSource') }}</Label>
            <Select :model-value="filters.sourceType || '__all'" @update:model-value="filters.sourceType = $event === '__all' ? '' : String($event)">
              <SelectTrigger :aria-label="t('projects.filterSource')"><SelectValue :placeholder="t('projects.filterSourceAll')" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{{ t('projects.filterSourceAll') }}</SelectItem>
                <SelectItem v-for="(label, source) in sourceLabels" :key="source" :value="source">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button :disabled="loading" type="submit">{{ t('projects.search') }}</Button>
        </form>

        <div v-if="loading" role="status" class="flex items-center gap-3 p-6"><Loader2 class="size-5 animate-spin" />{{ t('projects.loading') }}</div>
        <Card v-if="error" role="alert">
          <CardContent class="space-y-3 p-6">
            <p class="text-destructive">{{ error }}</p>
            <Button variant="outline" @click="load()">{{ t('projects.reload') }}</Button>
          </CardContent>
        </Card>

        <template v-if="!route.params.projectId && list && !error">
          <Card v-if="!list.items.length">
            <CardContent class="space-y-3 p-8">
              <BriefcaseBusiness class="size-8 text-muted-foreground" />
              <h2 class="text-lg font-medium">{{ t('projects.empty') }}</h2>
              <p class="text-sm text-muted-foreground">{{ t('projects.emptyDesc') }}</p>
              <Button as-child><RouterLink to="/ai-selection">{{ t('projects.startSearch') }}</RouterLink></Button>
            </CardContent>
          </Card>
          <RouterLink v-for="project in list.items" :key="project.projectId" :to="`/my-projects/${project.projectId}`" class="block space-y-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <h2 class="break-words text-lg font-medium">{{ project.exhibition?.name ?? t('projects.itemManualLabel') }}</h2>
                <p class="text-sm text-muted-foreground">
                  {{ joinParts([sourceLabels[project.sourceType], project.schemeCode ? t('projects.itemScheme', { code: project.schemeCode }) : t('projects.itemNoScheme'), joinParts([regionName(project.exhibition?.countryCode, appLocale), project.exhibition?.city], ' / '), dateRange(project.exhibition?.startDate, project.exhibition?.endDate, t)]) }}
                </p>
              </div>
              <StatusBadge domain="project" :status="project.status" class="rounded-full px-3 py-1" />
            </div>
            <p class="rounded-md bg-muted/50 px-3 py-2 text-sm"><span class="font-medium">{{ t('projects.itemNextStep') }}</span>{{ nextSteps[project.status] }}</p>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{{ t('projects.itemUpdatedAt', { date: date(project.updatedAt) }) }} <span class="font-mono">{{ project.projectNo }}</span></span>
              <span class="flex items-center gap-1 text-primary">{{ t('projects.viewDetail') }}<ArrowRight class="size-3" aria-hidden="true" /></span>
            </div>
          </RouterLink>
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">{{ t('projects.totalCount', { total: list.total, page: page }) }}</span>
            <div class="flex gap-2">
              <Button variant="outline" :disabled="page === 1 || loading" @click="load(page - 1)">{{ t('common.previousPage') }}</Button>
              <Button variant="outline" :disabled="page * pageSize >= list.total || loading" @click="load(page + 1)">{{ t('common.nextPage') }}</Button>
            </div>
          </div>
        </template>

        <template v-if="route.params.projectId && detail && !error">
          <Card>
            <CardContent class="space-y-4 p-6">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <h2 class="break-words text-2xl font-semibold">{{ detail.request.exhibition?.name ?? t('projects.itemManualLabel') }}</h2>
                  <p class="text-sm text-muted-foreground">{{ sourceLabels[detail.sourceType] }} · {{ t('projects.detailProjectId') }} <span class="font-mono">{{ detail.projectNo }}</span></p>
                </div>
                <StatusBadge domain="project" :status="detail.status" class="rounded-full px-3 py-1" />
              </div>
              <p class="rounded-md bg-muted/50 px-3 py-2 text-sm"><span class="font-medium">{{ t('projects.itemNextStep') }}</span>{{ nextSteps[detail.status] }}</p>
              <Button variant="outline" @click="openCustomerService({ kind: 'project', projectId: detail.projectId }, 'my_project')"><MessageCircle class="mr-2 size-4" aria-hidden="true" />{{ t('customerService.consult') }}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="space-y-3 p-6">
              <h2 class="text-lg font-medium">{{ t('projects.progressTitle') }}</h2>
              <p class="whitespace-pre-wrap break-words text-sm">{{ detail.publicResult ?? t('projects.progressEmpty') }}</p>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-xs text-muted-foreground">{{ t('projects.progressUpdatedAt') }}{{ date(detail.updatedAt) }}</p>
                <Button variant="outline" :disabled="loading" @click="load()">{{ t('projects.progressRefresh') }}</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="space-y-5 p-6">
              <h2 class="text-lg font-medium">{{ t('projects.requestTitle') }}</h2>
              <dl class="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt class="text-muted-foreground">{{ t('projects.requestLocation') }}</dt><dd>{{ exhibitionPlace(detail.request.exhibition) || t('projects.requestPending') }}</dd></div>
                <div><dt class="text-muted-foreground">{{ t('projects.requestDate') }}</dt><dd>{{ dateRange(detail.request.exhibition?.startDate, detail.request.exhibition?.endDate, t) || t('projects.requestPending') }}</dd></div>
                <div><dt class="text-muted-foreground">{{ t('projects.requestContact') }}</dt><dd>{{ joinParts([detail.request.company, detail.request.contact.name], ' / ') || t('projects.requestPending') }}</dd></div>
                <div>
                  <dt class="text-muted-foreground">{{ t('projects.requestContactInfo') }}</dt>
                  <dd v-if="contactLines.length" class="break-words"><span v-for="line in contactLines" :key="line" class="block">{{ line }}</span></dd>
                  <dd v-else>{{ t('projects.requestPending') }}</dd>
                </div>
                <div><dt class="text-muted-foreground">{{ t('projects.requestBudget') }}</dt><dd>{{ detail.request.materialBudget ? `${detail.request.materialBudget.currency} ${detail.request.materialBudget.amount}` : t('projects.requestPending') }}</dd></div>
                <div><dt class="text-muted-foreground">{{ t('projects.requestCreatedAt') }}</dt><dd>{{ date(detail.createdAt) }}</dd></div>
              </dl>
              <div class="space-y-2 text-sm">
                <p class="text-muted-foreground">{{ t('projects.scopeTitle') }}</p>
                <div v-if="detail.request.scopeCodes.length" class="flex flex-wrap gap-2"><Badge v-for="code in detail.request.scopeCodes" :key="code" variant="secondary">{{ getScopeLabel(code, t) }}</Badge></div>
                <p v-else>{{ t('projects.requestPending') }}</p>
                <p v-if="detail.request.scopeNotes" class="whitespace-pre-wrap break-words">{{ detail.request.scopeNotes }}</p>
              </div>
              <div v-if="detail.request.originalDescription" class="space-y-2 text-sm">
                <p class="text-muted-foreground">{{ t('projects.descriptionTitle') }}</p>
                <p class="whitespace-pre-wrap break-words">{{ detail.request.originalDescription }}</p>
              </div>
              <div v-if="detail.request.notes" class="space-y-2 text-sm">
                <p class="text-muted-foreground">{{ t('projects.remarksTitle') }}</p>
                <p class="whitespace-pre-wrap break-words">{{ detail.request.notes }}</p>
              </div>
              <div v-if="detail.request.unresolvedQuestions.length" class="space-y-2 text-sm">
                <p class="text-muted-foreground">{{ t('projects.unresolvedTitle') }}</p>
                <ul class="list-disc space-y-1 pl-5"><li v-for="question in detail.request.unresolvedQuestions" :key="question" class="break-words">{{ question }}</li></ul>
              </div>
              <div v-if="requirement.specs.length || requirement.groups.length" class="space-y-3 text-sm">
                <p class="text-muted-foreground">{{ t('projects.confirmedTitle') }}</p>
                <div v-if="requirement.specs.length" class="flex flex-wrap gap-2"><Badge v-for="spec in requirement.specs" :key="spec" variant="outline">{{ spec }}</Badge></div>
                <dl v-if="requirement.groups.length" class="grid gap-3 sm:grid-cols-2">
                  <div v-for="group in requirement.groups" :key="group.label" class="space-y-1">
                    <dt class="text-xs text-muted-foreground">{{ group.label }}</dt>
                    <dd class="flex flex-wrap gap-2"><Badge v-for="value in group.values" :key="value" variant="secondary">{{ value }}</Badge></dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="space-y-4 p-6">
              <h2 class="text-lg font-medium">{{ t('projects.schemeTitle') }}</h2>
              <div v-if="detail.schemeSnapshot" class="space-y-1 text-sm">
                <p class="font-medium">{{ detail.schemeSnapshot.name }}<span class="ml-2 font-mono text-xs font-normal text-muted-foreground">{{ detail.schemeSnapshot.code }}</span></p>
                <p class="text-muted-foreground">{{ detail.schemeSnapshot.lengthMm / 1000 }} × {{ detail.schemeSnapshot.widthMm / 1000 }} m · {{ t('projects.schemeMeta', { height: detail.schemeSnapshot.heightMm / 1000, openings: detail.schemeSnapshot.openingCount, revision: detail.schemeSnapshot.revision }) }}</p>
              </div>
              <p v-else class="text-sm text-muted-foreground">{{ t('projects.noScheme') }}</p>
              <img v-if="detail.selectedThemeSummary" :src="detail.selectedThemeSummary.previewUrl" :alt="t('projects.selectedTheme')" class="aspect-video w-full rounded-lg object-contain" />
              <div class="grid gap-3 sm:grid-cols-3">
                <div v-for="(value, type) in detail.materialsStatus" :key="type" class="rounded-md bg-muted p-4 text-sm">{{ materialTypeLabels[type] ?? type }}：{{ materialLabels[value] ?? value }}</div>
              </div>
              <Button v-if="detail.artworkJobId" variant="outline" as-child>
                <RouterLink :to="{ path: `/artwork-jobs/${detail.artworkJobId}`, query: { projectId: detail.projectId } }">{{ t('projects.viewArtwork') }}<ArrowRight class="ml-2 size-4" /></RouterLink>
              </Button>
              <Button v-else-if="canSupplementArtworks" variant="outline" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(detail.schemeCode!)}/artwork`, query: { themeJobId: detail.selectedThemeSummary!.themeJobId, projectId: detail.projectId } }">{{ t('projects.addArtwork') }}<ArrowRight class="ml-2 size-4" /></RouterLink>
              </Button>
              <p class="text-xs text-muted-foreground">{{ t('projects.schemeDisclaimer') }}</p>
            </CardContent>
          </Card>
        </template>
      </template>
    </main>
  </MainLayout>
</template>
