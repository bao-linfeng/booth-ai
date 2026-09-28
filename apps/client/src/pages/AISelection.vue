<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowRight, Sparkles, ShieldCheck, SlidersHorizontal, MessageCircle, Search, LoaderCircle, CircleAlert, ArrowUpRight } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import RequirementForm from '@/features/selection/RequirementForm.vue'
import SchemeCard from '@/features/selection/SchemeCard.vue'
import BoothIllustration from '@/features/selection/BoothIllustration.vue'
import { emptyRequirement, sides, type SelectionState, type Catalog, type MatchItem, type MatchResponse, type ParseResponse, type Requirement } from '@/features/selection/types'
import { previewCatalog, previewItems, previewStates } from '@/features/selection/preview'
import { apiFetch } from '@/lib/api-client'

const route = useRoute()
const isPreview = computed(() => route.path.startsWith('/ai-selection/preview'))
const requirement = ref(emptyRequirement())
const text = ref('')
const state = ref<SelectionState>('idle')
const previewMode = ref('idle')
const mobileConditions = ref(false)
const manualOpen = ref(false)
const snapshot = ref('')
const stale = computed(() => !!snapshot.value && snapshot.value !== JSON.stringify({ requirement: requirement.value, text: text.value }))
const busy = computed(() => state.value === 'parsing' || state.value === 'matching')

const liveCatalog = ref<Catalog | null>(null)
const liveItems = ref<MatchItem[]>([])
const liveMatchData = ref<MatchResponse | null>(null)
const liveClarifications = ref<ParseResponse['clarifications']>([])
const parseResult = ref<ParseResponse | null>(null)
const parsedText = ref<string | null>(null)
const parsedRequirement = ref<Requirement | null>(null)
const catalogState = ref<'loading' | 'ready' | 'error'>('loading')
let requestSequence = 0
let catalogSequence = 0

const catalog = computed(() => isPreview.value ? previewCatalog : (liveCatalog.value ?? { dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] }, productSystems: [], styles: [], industries: [], budgetTiers: [], zones: [], features: [], applicabilityQuestions: [] }))
const textChangedSinceParse = computed(() => parsedText.value !== null && parsedText.value !== text.value)
const unresolvedClarifications = computed(() => liveClarifications.value.filter(item => {
  if (!parsedRequirement.value || item.field === 'text') return true
  const field = item.field as keyof Requirement
  if (!(field in requirement.value)) return true
  if (item.field === 'lengthMm' && item.question.includes('长宽方向')) {
    return !requirement.value.lengthMm || !requirement.value.widthMm ||
      (requirement.value.lengthMm === parsedRequirement.value.lengthMm && requirement.value.widthMm === parsedRequirement.value.widthMm)
  }
  return JSON.stringify(requirement.value[field]) === JSON.stringify(parsedRequirement.value[field])
}))
const canConfirm = computed(() => !!parsedRequirement.value && !textChangedSinceParse.value && !unresolvedClarifications.value.length)
const sourceRows = computed(() => parseResult.value ? Object.entries(parseResult.value.fieldSources)
  .filter(([field, source]) => source.source !== 'form' || displayValue(field, requirement.value[field as keyof Requirement]) !== '未填写' ||
    (parsedRequirement.value && JSON.stringify(requirement.value[field as keyof Requirement]) !== JSON.stringify(parsedRequirement.value[field as keyof Requirement])))
  .map(([field, source]) => ({
    field,
    label: fieldLabel(field),
    source: parsedRequirement.value && JSON.stringify(requirement.value[field as keyof Requirement]) !== JSON.stringify(parsedRequirement.value[field as keyof Requirement]) ? '人工修正' : { form: '表单', text: '文字识别', derived: '自动计算' }[source.source],
    value: displayValue(field, requirement.value[field as keyof Requirement]),
    evidence: source.evidence
  })) : [])
const items = computed(() => isPreview.value 
  ? previewItems.map(item => previewMode.value === 'random' ? { ...item, matchType: 'random' as const, reasons: [], differences: [], pendingConfirmations: ['尺寸、开口方向、限高和适用条件待确认'] } : item)
  : liveItems.value
)

const chips = computed(() => {
  const r = requirement.value
  const currentCatalog = catalog.value
  return [
    r.lengthMm ? `长 ${r.lengthMm / 1000} m` : '', 
    r.widthMm ? `宽 ${r.widthMm / 1000} m` : '', 
    r.areaM2 ? `${r.areaM2} ㎡` : '', 
    r.maxHeightMm ? `限高 ${r.maxHeightMm / 1000} m` : '', 
    r.openingCount ? `${r.openingCount} 面开口` : '', 
    ...(r.openSides ?? []).map(id => sides.find(side => side.id === id)!.label), 
    ...currentCatalog.styles.filter(option => r.styleIds.includes(option.id)).map(option => option.label)
  ].filter(Boolean)
})

function reset() { requestSequence++; requirement.value = emptyRequirement(); text.value = ''; parsedText.value = null; parsedRequirement.value = null; parseResult.value = null; liveClarifications.value = []; state.value = 'idle'; snapshot.value = '' }
function clearText() {
  text.value = ''
  parsedText.value = null
  parsedRequirement.value = null
  parseResult.value = null
  liveClarifications.value = []
  if (state.value === 'needs_clarification') state.value = 'idle'
}

const fieldLabels: Record<keyof Requirement, string> = {
  lengthMm: '展位长', widthMm: '展位宽', maxHeightMm: '场馆限高', areaM2: '面积',
  openingCount: '开口面数', openSides: '开口方向', productSystemId: '产品体系',
  styleIds: '设计风格', industryIds: '适用行业', budgetTierId: '材料预算',
  zoneIds: '功能分区', featureIds: '特色功能', keywords: '关键词',
  requiredZoneIds: '必须分区', requiredFeatureIds: '必须特色',
  excludedZoneIds: '禁止分区', excludedFeatureIds: '禁止特色', applicabilityAnswers: '适用条件'
}
function fieldLabel(field: string) { return fieldLabels[field as keyof Requirement] ?? field }
function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length)) return '未填写'
  if (typeof value === 'number') return ['lengthMm', 'widthMm', 'maxHeightMm'].includes(field) ? `${value / 1000} m` : field === 'areaM2' ? `${value} ㎡` : String(value)
  const options = [...catalog.value.productSystems, ...catalog.value.styles, ...catalog.value.industries, ...catalog.value.budgetTiers, ...catalog.value.zones, ...catalog.value.features]
  const label = (id: string) => field === 'openSides' ? sides.find(side => side.id === id)?.label ?? id : options.find(option => option.id === id)?.label ?? id
  if (Array.isArray(value)) return value.map(id => label(String(id))).join('、')
  if (typeof value === 'object') return Object.entries(value).map(([id, answer]) => `${catalog.value.applicabilityQuestions.find(question => question.id === id)?.label ?? id}：${answer ? '是' : '否'}`).join('、') || '未填写'
  return label(String(value))
}

async function parseText(sequence: number) {
  state.value = 'parsing'
  try {
    const res = await apiFetch<{ code: number; data: ParseResponse }>('/api/v1/client/requirements/parse', {
      method: 'POST', body: { text: text.value, form: requirement.value }
    })
    if (sequence !== requestSequence) return false
    if (res.code !== 0) throw new Error('Parse unavailable')
    requirement.value = res.data.requirement
    parsedText.value = text.value
    parsedRequirement.value = structuredClone(res.data.requirement)
    parseResult.value = res.data
    liveClarifications.value = res.data.clarifications
    if (res.data.status === 'needs_clarification') {
      state.value = 'needs_clarification'
      snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
      return false
    }
    return true
  } catch (error) {
    if (sequence !== requestSequence) return false
    console.error('Parse failed', error)
    state.value = 'error'
    return false
  }
}

async function reparseText() {
  if (busy.value || !text.value.trim() || catalogState.value !== 'ready') return
  const sequence = ++requestSequence
  if (await parseText(sequence)) await doMatch('filtered', true, sequence)
}

function choosePreview(value: string) {
  previewMode.value = value
  if (value === 'results' || value === 'needs_clarification') {
    requirement.value = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 4500, openingCount: 2, openSides: ['front', 'left'], styleIds: ['modern-minimal'], productSystemId: 'fs62' }
    text.value = '长6米，宽3米，两面开口，现代简约风格，需要洽谈区。'
  } else if (value === 'random' || value === 'idle') reset()
  state.value = value === 'random' ? 'results' : value as SelectionState
  snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
}

async function loadCatalog() {
  if (isPreview.value) return
  const sequence = ++catalogSequence
  catalogState.value = 'loading'
  try {
    const res = await apiFetch<{ code: number; data: Catalog }>('/api/v1/client/catalog/options')
    if (sequence !== catalogSequence) return
    if (res.code !== 0) throw new Error('Catalog unavailable')
    liveCatalog.value = res.data
    catalogState.value = 'ready'
  } catch (error) {
    if (sequence !== catalogSequence) return
    console.error('Failed to load catalog', error)
    catalogState.value = 'error'
  }
}

async function doMatch(mode: 'random' | 'filtered', textProvided: boolean, sequence: number) {
  state.value = 'matching'
  try {
    const res = await apiFetch<{ code: number; data: MatchResponse }>('/api/v1/client/scheme-matches', {
      method: 'POST',
      body: { mode, requirement: requirement.value, inputContext: { textProvided } }
    })
    if (sequence !== requestSequence) return
    if (res.code === 0) {
      liveMatchData.value = res.data
      liveItems.value = res.data.items
      state.value = res.data.status === 'matched' ? 'results' : res.data.status === 'no_match' ? 'empty' : 'needs_clarification'
      snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
    } else {
      state.value = 'error'
    }
  } catch (error) {
    if (sequence !== requestSequence) return
    console.error('Match failed', error)
    state.value = 'error'
  }
}

async function submit() {
  if (busy.value || (!isPreview.value && catalogState.value !== 'ready')) return
  if (isPreview.value) {
    choosePreview(text.value.trim() ? 'needs_clarification' : chips.value.length ? 'results' : 'random')
    return
  }
  const sequence = ++requestSequence
  const textProvided = !!text.value.trim()
  if (textProvided && !parsedRequirement.value) {
    if (!await parseText(sequence)) return
  }
  if (textChangedSinceParse.value || (textProvided && unresolvedClarifications.value.length)) {
    state.value = 'needs_clarification'
    return
  }
  
  const isReqEmpty = Object.values(requirement.value).every(val => val === null || (Array.isArray(val) && val.length === 0) || (typeof val === 'object' && Object.keys(val).length === 0))
  await doMatch(isReqEmpty && !textProvided ? 'random' : 'filtered', textProvided, sequence)
}

function confirm() { 
  if (isPreview.value) {
    state.value = 'results'
    snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
  } else {
    if (busy.value || !canConfirm.value) return
    void doMatch('filtered', !!text.value.trim(), ++requestSequence)
  }
}

watch(isPreview, (newVal) => { 
  catalogSequence++
  reset()
  if (!newVal) loadCatalog()
})

onUnmounted(() => { requestSequence++; catalogSequence++ })

onMounted(() => {
  if (!isPreview.value) loadCatalog()
})
</script>

<template>
  <SelectionShell>
    <main class="container mx-auto space-y-6 px-4 py-8 pb-28 md:px-6 lg:px-8 lg:pb-12">
      <section class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2"><Badge variant="secondary">AI 智选 · 展台方案</Badge><h1 class="text-2xl font-semibold tracking-tight md:text-3xl">好展台，从选对方案开始</h1><p class="text-sm text-muted-foreground">描述参展需求，发现适合您的空间方案。</p></div>
        <p class="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck class="size-4 text-primary" />免费匹配 · 无需登录 · 不扣积分</p>
      </section>
      <Card v-if="!isPreview && catalogState !== 'ready'" :role="catalogState === 'error' ? 'alert' : 'status'"><CardContent class="flex items-center justify-between gap-4 p-5 text-sm"><span>{{ catalogState === 'loading' ? '正在加载选型条件…' : '选型条件加载失败，请重试。' }}</span><Button v-if="catalogState === 'error'" variant="outline" @click="loadCatalog">重新加载</Button></CardContent></Card>
      <Card v-if="isPreview" class="border-dashed"><CardHeader class="pb-3"><CardTitle class="text-sm">UI 静态预览</CardTitle><CardDescription>示例编号与空间示意仅用于界面评审，不代表真实匹配。</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-2"><Button v-for="option in previewStates" :key="option.id" size="sm" :variant="previewMode === option.id ? 'default' : 'outline'" :aria-pressed="previewMode === option.id" @click="choosePreview(option.id)">{{ option.label }}</Button></CardContent></Card>
      <Button variant="outline" class="w-full justify-between lg:hidden" :aria-expanded="mobileConditions" aria-controls="selection-conditions" @click="mobileConditions = !mobileConditions"><span class="flex items-center gap-2"><SlidersHorizontal class="size-4" />展位条件与偏好</span><Badge variant="secondary">{{ chips.length ? `${chips.length} 项` : '选填' }}</Badge></Button>
      <div class="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside id="selection-conditions" :class="cn('space-y-4 lg:block', !mobileConditions && 'hidden')"><RequirementForm v-model="requirement" :catalog="catalog" :disabled="busy || (!isPreview && catalogState !== 'ready')" @reset="reset" /><p class="px-2 text-xs leading-relaxed text-muted-foreground">结构条件决定适用性，风格与预算帮助排序。信息不全时也可以先看参考方案。</p></aside>
        <div class="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle class="flex items-center gap-2 text-base"><Sparkles class="size-4 text-primary" />描述您的理想展台</CardTitle>
              <CardDescription>文字输入为可选项，识别后可核对与修正。</CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              <Label for="requirement-text" class="sr-only">一句话描述需求</Label>
              <Textarea id="requirement-text" :model-value="text" maxlength="1000" :disabled="busy" class="min-h-28" placeholder="例如：长6米、宽3米，前侧和左侧开口，限高4.5米，希望有洽谈区……" @update:model-value="text = String($event)" />
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted-foreground">试试：</span>
                <Button variant="secondary" size="sm" :disabled="busy" @click="text = '长6米、宽3米，现代简约风格，需要洽谈区'">简约洽谈空间<ArrowUpRight class="ml-1 size-3" /></Button>
                <Button variant="secondary" size="sm" :disabled="busy" @click="text = '医疗健康行业，必须有储藏间'">医疗 · 带储藏间<ArrowUpRight class="ml-1 size-3" /></Button>
              </div>
            </CardContent>
            <CardFooter class="justify-between border-t pt-3">
              <span class="text-xs text-muted-foreground">文字可覆盖表单条件 · {{ text.length }} / 1000</span>
               <Button variant="ghost" size="sm" :disabled="busy || (!text && !parseResult)" @click="clearText">清空</Button>
            </CardFooter>
          </Card>
           <div class="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0"><p class="text-xs text-muted-foreground">不填条件，也能发现随机灵感</p><Button :disabled="busy || (!isPreview && catalogState !== 'ready')" class="gap-2" @click="submit"><LoaderCircle v-if="busy" class="size-4 animate-spin" /><Sparkles v-else class="size-4" />{{ busy ? state === 'parsing' ? '识别需求中' : '查找方案中' : 'AI 智选' }}<ArrowRight v-if="!busy" class="size-4" /></Button></div>
           <Card v-if="chips.length" class="bg-muted/30"><CardHeader class="pb-3"><div class="flex flex-wrap items-center justify-between gap-2"><CardTitle class="text-sm">当前条件 <span class="font-normal text-muted-foreground">/ 表单</span></CardTitle><Badge v-if="stale" variant="outline">条件已修改 · 结果基于上次条件</Badge></div></CardHeader><CardContent class="space-y-3"><div class="flex flex-wrap gap-2"><Badge v-for="chip in chips" :key="chip" variant="outline">{{ chip }}</Badge></div><p class="text-xs text-muted-foreground">风格、行业及预算为排序偏好；限高与产品体系为严格条件。</p></CardContent></Card>
           <Card v-if="!isPreview && parseResult"><CardHeader class="flex-row items-start justify-between gap-3"><div class="space-y-1"><CardTitle class="text-sm">需求识别与修正</CardTitle><CardDescription>核对文字覆盖的条件；手动修改表单后直接匹配，旧文字不会再次覆盖。</CardDescription></div><Button size="sm" variant="outline" :disabled="busy || !text.trim()" @click="reparseText">重新解析文字</Button></CardHeader><CardContent class="space-y-4 text-sm"><p v-if="textChangedSinceParse" class="text-warning" role="status">描述已修改；当前条件仍来自上次解析。需要应用新文字时请点击“重新解析文字”。</p><p v-if="parseResult.degraded" class="text-xs text-muted-foreground">当前使用规则识别；未识别文字须确认后再匹配。</p><dl class="grid gap-2 sm:grid-cols-2"><div v-for="row in sourceRows" :key="row.field" class="rounded-md border p-3"><dt class="flex items-center justify-between gap-2 font-medium"><span>{{ row.label }}</span><Badge variant="outline">{{ row.source }}</Badge></dt><dd class="mt-1 break-words">{{ row.value }}</dd><p v-if="row.evidence" class="mt-1 break-words text-xs text-muted-foreground">依据：{{ row.evidence }}</p></div></dl><div v-if="parseResult.overrides.length" class="space-y-2"><strong class="text-xs">文字覆盖了表单条件</strong><p v-for="override in parseResult.overrides" :key="override.field" class="break-words text-xs">{{ fieldLabel(override.field) }}：{{ displayValue(override.field, override.previousValue) }} → {{ displayValue(override.field, override.value) }} · 依据：{{ override.evidence }}</p></div><div v-if="parseResult.unhandledText.length" class="text-xs text-warning">未识别：{{ parseResult.unhandledText.join('、') }}</div></CardContent></Card>
          
          <Card v-if="state === 'needs_clarification'"><CardHeader><CardTitle class="flex items-center gap-2 text-base"><CircleAlert class="size-5" />请先确认，我们是否理解正确？</CardTitle><CardDescription>{{ isPreview ? '澄清状态示例：“6×3”尚不能确定左右跨度和前后进深。' : '解析过程中遇到模糊要求，需您确认。' }}</CardDescription></CardHeader><CardContent class="space-y-4">
            <template v-if="isPreview">
              <div class="flex flex-wrap gap-2"><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 6000, widthMm: 3000, areaM2: 18 }">长 6 m × 宽 3 m</Button><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 3000, widthMm: 6000, areaM2: 18 }">长 3 m × 宽 6 m</Button></div>
            </template>
            <template v-else>
              <div class="space-y-3">
                <div v-for="(clarification, i) in liveClarifications" :key="i" class="text-sm text-foreground">
                  <p :class="unresolvedClarifications.includes(clarification) ? 'font-medium text-warning' : 'text-muted-foreground'">{{ clarification.question }} <span v-if="!unresolvedClarifications.includes(clarification)">· 已修正</span></p>
                </div>
              </div>
            </template>
             <p class="text-xs text-muted-foreground">{{ !isPreview && liveClarifications.some(item => item.field === 'text') ? '仍有未识别的文字，请修改描述后重新解析，或转人工确认。' : '请先核对并修正表单条件；只有点击“重新解析文字”才会再次识别。' }}</p><Button :disabled="!isPreview && !canConfirm" @click="confirm">确认已修正条件，继续匹配<ArrowRight class="ml-2 size-4" /></Button><Button v-if="!isPreview && liveClarifications.some(item => item.field === 'text')" variant="outline" @click="manualOpen = true">转人工确认</Button></CardContent></Card>
          
          <Card v-if="state === 'idle'" class="overflow-hidden"><CardContent class="grid items-center gap-3 p-0 xl:grid-cols-2"><div class="space-y-5 p-6"><Badge variant="outline">从想法到空间</Badge><h2 class="text-2xl font-semibold leading-relaxed">让参展想法，<br />有一个具体的空间</h2><p class="text-sm leading-relaxed text-muted-foreground">填写展位尺寸，或用一句话描述需求。先筛选结构，再匹配偏好。</p><ol class="flex flex-wrap gap-4 text-xs text-muted-foreground"><li>01 描述需求</li><li>02 匹配方案</li><li>03 查看详情</li></ol></div><BoothIllustration class="w-full" /></CardContent><CardFooter class="flex-wrap justify-between gap-2 border-t pt-4 text-xs text-muted-foreground"><span>最多 3 套方案 · 每套 3 个视角</span><span>条件不全时明确标注待确认项</span></CardFooter></Card>
          <Card v-else-if="busy" aria-live="polite" aria-busy="true"><CardContent class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><LoaderCircle class="size-8 animate-spin text-primary" /><h2 class="text-lg font-medium">{{ state === 'parsing' ? '正在识别您的需求' : '正在查找适合的方案' }}</h2><p class="text-sm text-muted-foreground">{{ isPreview ? '加载状态预览，可使用顶部工具栏切换。' : '正在调用接口匹配方案，请稍后。' }}</p><div class="w-full max-w-xs space-y-3"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-4/5" /><Skeleton class="h-3 w-3/5" /></div></CardContent></Card>
          <section v-else-if="state === 'results'" class="space-y-4" aria-live="polite"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{{ (isPreview ? previewMode === 'random' : liveMatchData?.mode === 'random') ? '先发现一些灵感' : '为您找到的空间方案' }}</h2><Badge variant="secondary">{{ (isPreview ? previewMode === 'random' : liveMatchData?.mode === 'random') ? '随机推荐 · 适用条件待确认' : (isPreview ? '1 套直接采用 · 2 套参考' : `${liveMatchData?.counts.direct ?? 0} 套直接采用 · ${liveMatchData?.counts.reference ?? 0} 套参考`) }}</Badge></div><SchemeCard v-for="(item, index) in items" :key="item.code" :item="item" :index="index" :preview="isPreview" /><p class="text-xs leading-relaxed text-muted-foreground">“可直接采用”指已提供结构条件与审核方案一致，不替代具体项目的报馆及施工确认。</p></section>
          <Card v-else-if="state === 'empty' || state === 'error'" :role="state === 'error' ? 'alert' : 'status'"><CardContent class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><Search v-if="state === 'empty'" class="size-8 text-muted-foreground" /><CircleAlert v-else class="size-8 text-muted-foreground" /><h2 class="text-lg font-medium">{{ state === 'empty' ? '当前组合暂时没有合适的方案' : isPreview ? '服务暂时不可用' : '请求失败' }}</h2><p class="max-w-md text-sm leading-relaxed text-muted-foreground">{{ state === 'empty' ? (liveMatchData?.reasons?.[0] || '您的需求已保留。可主动修改条件，或交给专业顾问。') : isPreview ? '输入已保留，系统异常不等于无匹配。当前可通过静态预览查看各界面状态。' : '接口调用失败，请检查网络或重试。' }}</p><div class="flex flex-wrap justify-center gap-2"><Button v-if="state === 'empty'" @click="mobileConditions = true; state = 'idle'">修改条件</Button><Button v-else-if="isPreview || state === 'error'" @click="submit">重试</Button><Button v-if="state === 'error' && !isPreview" as-child><RouterLink to="/ai-selection/preview">查看 UI 静态预览</RouterLink></Button><Button variant="outline" @click="manualOpen = true">转人工</Button></div></CardContent></Card>
          <Card><CardContent class="flex flex-wrap items-center gap-4 p-5"><MessageCircle class="size-6 text-primary" /><div class="flex-1 space-y-1"><h3 class="text-sm font-medium">特别的想法，交给专业的人</h3><p class="text-xs text-muted-foreground">尺寸特殊、需求复杂？让顾问一起梳理。</p></div><Button variant="outline" @click="manualOpen = true">转人工沟通<ArrowUpRight class="ml-2 size-4" /></Button></CardContent></Card>
        </div>
      </div>
    </main>
    <Dialog v-model:open="manualOpen"><DialogContent class="max-h-[90dvh] overflow-y-auto"><DialogTitle>把需求交给专业顾问</DialogTitle><DialogDescription>交接界面预览；接口尚未接入，不会发送或保存联系方式。</DialogDescription><Card><CardContent class="space-y-2 p-4 text-sm"><strong>需求摘要</strong><p>{{ text || '暂无文字描述' }}</p><p class="text-xs text-muted-foreground">{{ chips.join(' · ') || '尚未填写结构条件' }}</p></CardContent></Card><div class="space-y-2"><Label for="manual-name">联系人</Label><Input id="manual-name" placeholder="您的称呼" autocomplete="name" /></div><div class="space-y-2"><Label for="manual-contact">联系方式</Label><Input id="manual-contact" placeholder="手机号或邮箱" autocomplete="tel" /></div><Button disabled>提交入口待接入</Button></DialogContent></Dialog>
  </SelectionShell>
</template>
