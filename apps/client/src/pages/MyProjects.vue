<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Loader2 } from 'lucide-vue-next'
import StatusBadge from '@/components/StatusBadge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MainLayout from '@/layouts/MainLayout.vue'
import { scopeLabel } from '@/features/projects/labels'
import { closedStatuses, dateRange, joinParts, nextSteps, regionName, summarizeRequirement } from '@/features/projects/summary'
import type { Catalog } from '@/features/selection/types'
import { useAuthStore } from '@/stores/auth'
import { getCatalogOptions } from '@/services/api/catalog'
import { getMyProject, getMyProjects, statusLabels, type MyProjectDetail, type ProjectPage } from '@/services/api/projects'

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

const date = (value: string) => new Date(value).toLocaleString('zh-CN')
const materialLabels: Record<string, string> = { available: '已附带', pending: '待补充', missing: '暂无资料' }
const materialTypeLabels: Record<string, string> = { bom: '物料清单', drawings: '三视图', artworks: '四面素材' }
const sourceLabels = { quote_request: '报价申请', manual_request: '人工需求' }
const exhibitionPlace = (exhibition: MyProjectDetail['request']['exhibition']) =>
  joinParts([regionName(exhibition?.countryCode), exhibition?.city], ' / ')
const requirement = computed(() => summarizeRequirement(detail.value?.request.confirmedRequirements, catalog.value))
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

async function load(next = page.value) {
  if (!auth.isLoggedIn) return
  loading.value = true
  error.value = ''
  page.value = next
  try {
    if (route.params.projectId) {
      detail.value = await getMyProject(String(route.params.projectId))
      if (detail.value.request.confirmedRequirements) void loadCatalog()
    } else list.value = await getMyProjects({ ...filters, page: next, pageSize })
  } catch (failure: unknown) {
    const status = (failure as { response?: { status?: number } }).response?.status
    error.value = status === 404 ? '项目不存在或不属于当前账户。' : '项目读取失败，请重试。'
  } finally {
    loading.value = false
  }
}
function login() { void router.push({ path: '/auth/sign-in', query: { redirect: route.fullPath } }) }
onMounted(() => load())
watch(() => route.params.projectId, () => { detail.value = undefined; list.value = undefined; void load(1) })
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm text-primary">展会项目 / 申请记录</p>
          <h1 class="studio-title">{{ route.params.projectId ? '项目详情' : '我的项目' }}</h1>
          <p class="text-sm text-muted-foreground">查看本人提交的报价申请和人工需求，了解当前状态与最新进展。</p>
        </div>
        <Button variant="outline" as-child>
          <RouterLink :to="route.params.projectId ? '/my-projects' : '/ai-selection'"><ArrowLeft class="mr-2 size-4" />{{ route.params.projectId ? '返回项目列表' : '继续选方案' }}</RouterLink>
        </Button>
      </header>

      <Card v-if="!auth.isLoggedIn">
        <CardContent class="space-y-4 p-8">
          <BriefcaseBusiness class="size-8 text-primary" />
          <p>登录后查看您的申请记录。</p>
          <Button @click="login">登录并返回</Button>
        </CardContent>
      </Card>

      <template v-else>
        <form v-if="!route.params.projectId" class="grid items-end gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-5" @submit.prevent="load(1)">
          <div class="space-y-2"><Label for="project-number">项目编号</Label><Input id="project-number" v-model="filters.projectNo" maxlength="200" /></div>
          <div class="space-y-2"><Label for="exhibition-filter">展会名称</Label><Input id="exhibition-filter" v-model="filters.exhibitionName" maxlength="200" /></div>
          <div class="space-y-2">
            <Label>状态</Label>
            <Select :model-value="filters.status || '__all'" @update:model-value="filters.status = $event === '__all' ? '' : String($event)">
              <SelectTrigger aria-label="状态"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">全部状态</SelectItem>
                <SelectItem v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2">
            <Label>来源</Label>
            <Select :model-value="filters.sourceType || '__all'" @update:model-value="filters.sourceType = $event === '__all' ? '' : String($event)">
              <SelectTrigger aria-label="来源"><SelectValue placeholder="全部来源" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">全部来源</SelectItem>
                <SelectItem v-for="(label, source) in sourceLabels" :key="source" :value="source">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button :disabled="loading" type="submit">查询项目</Button>
        </form>

        <div v-if="loading" role="status" class="flex items-center gap-3 p-6"><Loader2 class="size-5 animate-spin" />正在读取项目…</div>
        <Card v-if="error" role="alert">
          <CardContent class="space-y-3 p-6">
            <p class="text-destructive">{{ error }}</p>
            <Button variant="outline" @click="load()">重新加载</Button>
          </CardContent>
        </Card>

        <template v-if="!route.params.projectId && list && !error">
          <Card v-if="!list.items.length">
            <CardContent class="space-y-3 p-8">
              <BriefcaseBusiness class="size-8 text-muted-foreground" />
              <h2 class="text-lg font-medium">暂无符合条件的项目</h2>
              <p class="text-sm text-muted-foreground">您提交报价申请或人工需求后，项目会出现在这里。</p>
              <Button as-child><RouterLink to="/ai-selection">开始选方案</RouterLink></Button>
            </CardContent>
          </Card>
          <RouterLink v-for="project in list.items" :key="project.projectId" :to="`/my-projects/${project.projectId}`" class="block space-y-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <h2 class="break-words text-lg font-medium">{{ project.exhibition?.name ?? '历史人工需求' }}</h2>
                <p class="text-sm text-muted-foreground">
                  {{ joinParts([sourceLabels[project.sourceType], project.schemeCode ? `方案 ${project.schemeCode}` : '尚未关联方案', joinParts([regionName(project.exhibition?.countryCode), project.exhibition?.city], ' / '), dateRange(project.exhibition?.startDate, project.exhibition?.endDate)]) }}
                </p>
              </div>
              <StatusBadge domain="project" :status="project.status" class="rounded-full px-3 py-1" />
            </div>
            <p class="rounded-md bg-muted/50 px-3 py-2 text-sm"><span class="font-medium">下一步：</span>{{ nextSteps[project.status] }}</p>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>最近更新 {{ date(project.updatedAt) }} · 项目编号 <span class="font-mono">{{ project.projectNo }}</span></span>
              <span class="flex items-center gap-1 text-primary">查看最新进展<ArrowRight class="size-3" aria-hidden="true" /></span>
            </div>
          </RouterLink>
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">共 {{ list.total }} 个项目 · 第 {{ page }} 页</span>
            <div class="flex gap-2">
              <Button variant="outline" :disabled="page === 1 || loading" @click="load(page - 1)">上一页</Button>
              <Button variant="outline" :disabled="page * pageSize >= list.total || loading" @click="load(page + 1)">下一页</Button>
            </div>
          </div>
        </template>

        <template v-if="route.params.projectId && detail && !error">
          <Card>
            <CardContent class="space-y-4 p-6">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <h2 class="break-words text-2xl font-semibold">{{ detail.request.exhibition?.name ?? '历史人工需求' }}</h2>
                  <p class="text-sm text-muted-foreground">{{ sourceLabels[detail.sourceType] }} · 项目编号 <span class="font-mono">{{ detail.projectNo }}</span></p>
                </div>
                <StatusBadge domain="project" :status="detail.status" class="rounded-full px-3 py-1" />
              </div>
              <p class="rounded-md bg-muted/50 px-3 py-2 text-sm"><span class="font-medium">下一步：</span>{{ nextSteps[detail.status] }}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="space-y-3 p-6">
              <h2 class="text-lg font-medium">最新进展</h2>
              <p class="whitespace-pre-wrap break-words text-sm">{{ detail.publicResult ?? '顾问正在处理，暂未发布进展。' }}</p>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-xs text-muted-foreground">最近更新：{{ date(detail.updatedAt) }}</p>
                <Button variant="outline" :disabled="loading" @click="load()">刷新进展</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="space-y-5 p-6">
              <h2 class="text-lg font-medium">申请内容</h2>
              <dl class="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt class="text-muted-foreground">展会地点</dt><dd>{{ exhibitionPlace(detail.request.exhibition) || '待补充' }}</dd></div>
                <div><dt class="text-muted-foreground">展会日期</dt><dd>{{ dateRange(detail.request.exhibition?.startDate, detail.request.exhibition?.endDate) || '待补充' }}</dd></div>
                <div><dt class="text-muted-foreground">公司 / 联系人</dt><dd>{{ joinParts([detail.request.company, detail.request.contact.name], ' / ') || '待补充' }}</dd></div>
                <div>
                  <dt class="text-muted-foreground">联系方式</dt>
                  <dd v-if="contactLines.length" class="break-words"><span v-for="line in contactLines" :key="line" class="block">{{ line }}</span></dd>
                  <dd v-else>待补充</dd>
                </div>
                <div><dt class="text-muted-foreground">材料预算</dt><dd>{{ detail.request.materialBudget ? `${detail.request.materialBudget.currency} ${detail.request.materialBudget.amount}` : '待补充' }}</dd></div>
                <div><dt class="text-muted-foreground">申请时间</dt><dd>{{ date(detail.createdAt) }}</dd></div>
              </dl>
              <div class="space-y-2 text-sm">
                <p class="text-muted-foreground">需求范围</p>
                <div v-if="detail.request.scopeCodes.length" class="flex flex-wrap gap-2"><Badge v-for="code in detail.request.scopeCodes" :key="code" variant="secondary">{{ scopeLabel(code) }}</Badge></div>
                <p v-else>待补充</p>
                <p v-if="detail.request.scopeNotes" class="whitespace-pre-wrap break-words">{{ detail.request.scopeNotes }}</p>
              </div>
              <div v-if="detail.request.originalDescription ?? detail.request.notes" class="space-y-2 text-sm">
                <p class="text-muted-foreground">{{ detail.request.originalDescription ? '需求描述' : '备注' }}</p>
                <p class="whitespace-pre-wrap break-words">{{ detail.request.originalDescription ?? detail.request.notes }}</p>
              </div>
              <div v-if="requirement.specs.length || requirement.groups.length" class="space-y-3 text-sm">
                <p class="text-muted-foreground">已确认的需求条件</p>
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
              <h2 class="text-lg font-medium">方案与资料</h2>
              <div v-if="detail.schemeSnapshot" class="space-y-1 text-sm">
                <p class="font-medium">{{ detail.schemeSnapshot.name }}<span class="ml-2 font-mono text-xs font-normal text-muted-foreground">{{ detail.schemeSnapshot.code }}</span></p>
                <p class="text-muted-foreground">{{ detail.schemeSnapshot.lengthMm / 1000 }} × {{ detail.schemeSnapshot.widthMm / 1000 }} m · 高 {{ detail.schemeSnapshot.heightMm / 1000 }} m · {{ detail.schemeSnapshot.openingCount }} 面开口 · 方案修订 {{ detail.schemeSnapshot.revision }}</p>
              </div>
              <p v-else class="text-sm text-muted-foreground">尚未关联方案，顾问将与您沟通确认。</p>
              <img v-if="detail.selectedThemeSummary" :src="detail.selectedThemeSummary.previewUrl" alt="本项目选定的主题效果" class="aspect-video w-full rounded-lg object-contain" />
              <div class="grid gap-3 sm:grid-cols-3">
                <div v-for="(value, type) in detail.materialsStatus" :key="type" class="rounded-md bg-muted p-4 text-sm">{{ materialTypeLabels[type] ?? type }}：{{ materialLabels[value] ?? value }}</div>
              </div>
              <Button v-if="detail.artworkJobId" variant="outline" as-child>
                <RouterLink :to="{ path: `/artwork-jobs/${detail.artworkJobId}`, query: { projectId: detail.projectId } }">查看与下载已交付四面素材<ArrowRight class="ml-2 size-4" /></RouterLink>
              </Button>
              <Button v-else-if="canSupplementArtworks" variant="outline" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(detail.schemeCode!)}/artwork`, query: { themeJobId: detail.selectedThemeSummary!.themeJobId, projectId: detail.projectId } }">生成并补充项目四面素材<ArrowRight class="ml-2 size-4" /></RouterLink>
              </Button>
              <p class="text-xs text-muted-foreground">以上为提交申请时附带的资料状态，正式资料由顾问按项目交付。</p>
            </CardContent>
          </Card>
        </template>
      </template>
    </main>
  </MainLayout>
</template>
