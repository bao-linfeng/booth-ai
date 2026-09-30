<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Loader2, Sparkles, Image as ImageIcon, X, Plus } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import BoothIllustration from '@/features/selection/BoothIllustration.vue'
import { apiFetch } from '@/lib/api-client'
import { getThemeOffer, createThemeJob, type ThemeOffer, type ThemeJobInput } from '@/services/api/theme-jobs'
import { getThemeModels, type ThemeModel } from '@/services/api/theme-models'
import type { SchemeDetail, SchemeImage } from '@/features/selection/types'
import { useAuthStore } from '@/stores/auth'
import { useCredits } from '@/composables/useCredits'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const { balance, loading: loadingCredits, fetchBalance } = useCredits()
const isLoggedIn = computed(() => authStore.isLoggedIn)

const schemeCode = route.params.code as string
const isPreview = computed(() => route.path.startsWith('/ai-selection/preview/'))

// State
const schemeData = ref<SchemeDetail | null>(null)
const loadingScheme = ref(true)
const schemeError = ref(false)

const images = computed(() => schemeData.value?.images || [])
const selectedAssetId = ref<string>('')
const selectedImageUrl = computed(() => images.value.find(i => i.assetId === selectedAssetId.value)?.url)

const themeModels = ref<ThemeModel[]>([])
const loadingModels = ref(true)

// Form State
const industryId = ref<string>('')
const styleId = ref<string>('')
const brandColors = ref<string[]>([])
const brandKeywords = ref('')
const requestedCount = ref('1')
const selectedModel = ref<string>('')

const themeOffer = ref<ThemeOffer | null>(null)
const loadingOffer = ref(false)
const confirmDialogOpen = ref(false)
const creatingJob = ref(false)

const catalogIndustries = ref<{id: string; label: string}[]>([])
const catalogStyles = ref<{id: string; label: string}[]>([])

// Init
onMounted(async () => {
  if (isPreview.value) {
    loadingScheme.value = false
    loadingModels.value = false
    return
  }

  try {
    if (!isPreview.value && isLoggedIn.value) {
      fetchBalance()
    }

    const [schemeRes, modelsRes, catalogRes] = await Promise.all([
      apiFetch<{ code: number; data: SchemeDetail }>(`/api/v1/client/schemes/${encodeURIComponent(schemeCode)}`),
      getThemeModels().catch(() => []),
      apiFetch<{ code: number; data: { industries: {id: string; label: string}[], styles: {id: string; label: string}[] } }>('/api/v1/client/catalog/options').catch(() => null)
    ])

    if (catalogRes?.code === 0 && catalogRes.data) {
      catalogIndustries.value = catalogRes.data.industries || []
      catalogStyles.value = catalogRes.data.styles || []
    }

    if (schemeRes.code === 0) {
      schemeData.value = schemeRes.data
      if (images.value.length > 0) {
        selectedAssetId.value = images.value[0].assetId
      }
    } else {
      schemeError.value = true
    }

    themeModels.value = modelsRes
    if (modelsRes.length > 0) {
      selectedModel.value = modelsRes[0].provider
    }

    if (selectedAssetId.value) {
      await fetchOffer()
    }
  } catch (e) {
    console.error('Failed to load initial data', e)
    schemeError.value = true
  } finally {
    loadingScheme.value = false
    loadingModels.value = false
  }
})

// Auto fetch offer on change (debounce in real world, but here we just watch changes to some degree, 
// wait, the prompt says "先调用 API-092 获取 ThemeOffer... 操作按钮 -> 获取报价并确认". 
// Actually, it says: "页面加载：先获取方案详情... 再自动调用 API-092 获取能力", 
// and "获取报价并确认按钮... 先调用API获取能力...". Let's fetch initially, and also on button click before dialog.)
async function fetchOffer() {
  if (!schemeCode || !selectedAssetId.value || isPreview.value) return
  loadingOffer.value = true
  try {
    const hasFullInput = !!(industryId.value && styleId.value)
    const input: ThemeJobInput | undefined = hasFullInput ? {
      industryId: industryId.value,
      styleId: styleId.value,
      brandColors: brandColors.value,
      brandKeywords: brandKeywords.value
    } : undefined
    const res = await getThemeOffer(schemeCode, selectedAssetId.value, input, parseInt(requestedCount.value, 10))
    themeOffer.value = res
    
    // Auto-select valid industry and style if not set
    if (!industryId.value && res.supportedCombinations.length > 0) {
      industryId.value = res.supportedCombinations[0].industryId
    }
    if (!styleId.value && res.supportedCombinations.length > 0) {
      styleId.value = res.supportedCombinations[0].styleId
    }
  } catch (e) {
    console.error('Failed to fetch offer', e)
  } finally {
    loadingOffer.value = false
  }
}

// Watch selection changes to update offer
watch(selectedAssetId, () => {
  fetchOffer()
})

const uniqueIndustries = computed(() => catalogIndustries.value)

const availableStyles = computed(() => catalogStyles.value)

function addColor() {
  if (themeOffer.value && brandColors.value.length < themeOffer.value.limits.maxBrandColors) {
    brandColors.value.push('#000000')
  } else if (!themeOffer.value && brandColors.value.length < 3) {
    brandColors.value.push('#000000')
  }
}

function removeColor(index: number) {
  brandColors.value.splice(index, 1)
}

function updateColor(index: number, val: string) {
  brandColors.value[index] = val
}

const blockedReasonText = computed(() => {
  if (!themeOffer.value || themeOffer.value.available) return ''
  const reasons = themeOffer.value.blockedReasons || []
  if (reasons.includes('MASK_UNAVAILABLE')) return '暂无该视角的编辑蒙版'
  if (reasons.includes('TEMPLATE_UNAVAILABLE')) return '暂无适用的风格模板'
  if (reasons.includes('MODEL_UNAVAILABLE')) return '模型暂时不可用'
  return '当前视角暂不可生成'
})

async function handleGetQuote() {
  if (isPreview.value) return
  await fetchOffer()
  if (themeOffer.value?.available && themeOffer.value.offer) {
    confirmDialogOpen.value = true
  }
}

async function handleConfirm() {
  if (!themeOffer.value?.offer) return
  creatingJob.value = true
  try {
    const input: ThemeJobInput = {
      industryId: industryId.value,
      styleId: styleId.value,
      brandColors: brandColors.value,
      brandKeywords: brandKeywords.value
    }
    const payload = {
      requestKey: crypto.randomUUID(),
      offerId: themeOffer.value.offer.id,
      schemeCode,
      sourceAssetId: selectedAssetId.value,
      input,
      requestedCount: parseInt(requestedCount.value, 10),
      cacheMode: 'reuse' as const
    }
    const res = await createThemeJob(payload)
    confirmDialogOpen.value = false
    router.push(`/theme-jobs/${res.jobId}`)
  } catch (e) {
    console.error('Failed to create job', e)
    // TODO: show error toast if we had sonner setup here
  } finally {
    creatingJob.value = false
  }
}

</script>

<template>
  <SelectionShell>
    <main class="container mx-auto space-y-6 px-4 py-8 md:px-6 lg:px-8">
      <div class="flex items-center gap-4">
        <Button variant="ghost" class="-ml-3" @click="router.back()">
          <ArrowLeft class="mr-2 size-4" />返回方案详情
        </Button>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold">AI 换主题</h1>
          <Badge variant="outline">{{ schemeCode }}</Badge>
          <Badge v-if="isPreview" variant="secondary">预览模式</Badge>
        </div>
      </div>

      <div v-if="schemeError" class="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center text-destructive">
        <p>方案加载失败，请重试或返回重进。</p>
      </div>
      
      <div v-else-if="loadingScheme" class="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6">
        <Skeleton class="h-[600px] rounded-xl" />
        <Skeleton class="h-[600px] rounded-xl" />
      </div>

      <div v-else class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <!-- 左侧主区 -->
        <div class="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle class="text-base">选择原始效果图</CardTitle>
              <CardDescription>选择需要换主题的视角</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid grid-cols-3 gap-4">
                <div v-if="images.length === 0" class="col-span-3 aspect-video bg-muted rounded-md flex items-center justify-center">
                  <BoothIllustration class="w-24 h-24 opacity-50" />
                </div>
                <Button
                  v-for="img in images"
                  :key="img.assetId"
                  variant="ghost"
                  class="relative aspect-video overflow-hidden rounded-md border-2 transition-colors p-0 h-auto w-full"
                  :class="selectedAssetId === img.assetId ? 'border-primary' : 'border-transparent hover:border-primary/50'"
                  @click="selectedAssetId = img.assetId"
                >
                  <img :src="img.thumbnailUrl || img.url" class="object-cover w-full h-full" alt="效果图预览" />
                </Button>
              </div>

              <div class="mt-6 aspect-video overflow-hidden rounded-lg border bg-muted flex items-center justify-center relative">
                <img v-if="selectedImageUrl" :src="selectedImageUrl" class="object-contain w-full h-full" alt="选中效果图放大" />
                <BoothIllustration v-else class="w-32 h-32 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle class="text-base flex items-center gap-2">
                <Sparkles class="size-4" /> 可编辑区域说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-sm text-muted-foreground leading-relaxed">
                AI 换主题将保留原始方案的空间结构和材质质感，仅对画面中的品牌色、Logo、海报及展示画面进行智能替换。<br/>
                蒙版区域由方案本身决定，不支持自定义框选修改范围。
              </p>
            </CardContent>
          </Card>
        </div>

        <!-- 右侧表单区 -->
        <div class="space-y-6 flex-shrink-0">
          <Card>
            <CardHeader class="pb-3">
              <CardTitle class="text-sm font-medium text-muted-foreground">积分余额</CardTitle>
            </CardHeader>
            <CardContent>
              <div v-if="loadingCredits" class="py-1">
                <Skeleton class="h-8 w-24" />
              </div>
              <p v-else-if="balance !== null" class="text-2xl font-bold tracking-tight">{{ balance }} 积分</p>
              <p v-else class="text-2xl font-bold tracking-tight">--</p>
            </CardContent>
          </Card>

          <Card v-if="!isLoggedIn && !isPreview">
            <CardContent class="pt-6 space-y-4 text-center">
              <p class="text-sm text-muted-foreground">请先登录后使用 AI 换主题功能</p>
              <Button disabled class="w-full">登录以继续</Button>
            </CardContent>
          </Card>

          <Card v-else>
            <CardHeader>
              <CardTitle class="text-base">生成参数配置</CardTitle>
            </CardHeader>
            <CardContent class="space-y-5">
              <div class="space-y-2">
                <label class="text-sm font-medium">行业</label>
                <Select v-model="industryId" :disabled="loadingOffer || isPreview">
                  <SelectTrigger>
                    <SelectValue placeholder="选择行业" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="opt in uniqueIndustries" :key="opt.id" :value="opt.id">{{ opt.label }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-2">
                <label class="text-sm font-medium">风格</label>
                <Select v-model="styleId" :disabled="loadingOffer || isPreview">
                  <SelectTrigger>
                    <SelectValue placeholder="选择风格" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="opt in availableStyles" :key="opt.id" :value="opt.id">{{ opt.label }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium">品牌色</label>
                  <span class="text-xs text-muted-foreground">{{ brandColors.length }} / {{ themeOffer?.limits?.maxBrandColors || 3 }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <div v-for="(color, index) in brandColors" :key="index" class="flex items-center gap-2 bg-muted/50 p-1.5 rounded-md border">
                    <div class="relative size-8 rounded-md border shadow-sm flex items-center justify-center group" :style="{ backgroundColor: color }">
                      <input type="color" :value="color" @input="(e) => updateColor(index, (e.target as HTMLInputElement).value)" class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                      <div class="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer" @click.stop="removeColor(index)">
                        <X class="size-3" />
                      </div>
                    </div>
                    <Input :model-value="color" @update:model-value="(val) => updateColor(index, val as string)" class="w-24 h-8 text-xs font-mono uppercase" />
                  </div>
                  <Button
                    v-if="brandColors.length < (themeOffer?.limits?.maxBrandColors || 3)"
                    variant="outline"
                    size="icon"
                    class="size-8 rounded-md border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                    @click="addColor"
                    :disabled="isPreview"
                  >
                    <Plus class="size-4" />
                  </Button>
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium">品牌关键词</label>
                  <span class="text-xs text-muted-foreground">{{ brandKeywords.length }} / {{ themeOffer?.limits?.maxKeywordCharacters || 200 }}</span>
                </div>
                <Textarea 
                  v-model="brandKeywords"
                  placeholder="例如：智能科技、绿色环保、简洁现代"
                  class="resize-none"
                  :maxlength="themeOffer?.limits?.maxKeywordCharacters || 200"
                  :disabled="isPreview"
                  rows="3"
                />
              </div>

              <div class="space-y-2">
                <label class="text-sm font-medium">生成数量</label>
                <ToggleGroup type="single" v-model="requestedCount" class="justify-start gap-2" :disabled="isPreview">
                  <ToggleGroupItem v-for="n in (themeOffer?.limits?.allowedCounts || [1,2,3,4])" :key="n" :value="n.toString()" class="h-8 px-3 rounded-full data-[state=on]:bg-primary data-[state=on]:text-primary-foreground border">
                    {{ n }} 张
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div class="space-y-2">
                <label class="text-sm font-medium">图像模型</label>
                <Select v-model="selectedModel" :disabled="loadingModels || isPreview">
                  <SelectTrigger>
                    <SelectValue placeholder="加载中..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="m in themeModels" :key="m.provider" :value="m.provider">
                      {{ m.model }} · {{ m.unitCredits }} 积分/张
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card v-if="isLoggedIn || isPreview">
            <CardContent class="pt-6 space-y-4">
              <div v-if="loadingOffer" class="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 class="size-5 animate-spin mr-2" /> 预估费用中...
              </div>
              <template v-else-if="themeOffer">
                <div v-if="!themeOffer.available" class="rounded bg-destructive/10 p-3 text-sm text-destructive font-medium flex items-start gap-2">
                  <X class="size-4 shrink-0 mt-0.5" />
                  <span>{{ blockedReasonText }}</span>
                </div>
                <div v-else-if="themeOffer.offer" class="space-y-3">
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-muted-foreground">单张消耗</span>
                    <span class="font-mono">{{ themeOffer.offer.unitCredits }} 积分</span>
                  </div>
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-muted-foreground">生成数量</span>
                    <span class="font-mono">× {{ requestedCount }}</span>
                  </div>
                  <div class="pt-3 border-t flex justify-between items-center">
                    <span class="font-medium">预计总费用</span>
                    <span class="font-mono text-lg font-bold text-primary">{{ themeOffer.offer.maxCredits }} 积分</span>
                  </div>
                </div>
              </template>
              
              <Button 
                class="w-full" 
                size="lg"
                :disabled="isPreview || !themeOffer?.available || loadingOffer || !industryId || !styleId"
                @click="handleGetQuote"
              >
                <template v-if="isPreview">预览模式 · 不可提交</template>
                <template v-else-if="!themeOffer?.available">{{ blockedReasonText || '当前不可生成' }}</template>
                <template v-else>获取报价并确认</template>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>

    <!-- 确认弹窗 -->
    <Dialog :open="confirmDialogOpen" @update:open="confirmDialogOpen = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认生成换主题任务</DialogTitle>
          <DialogDescription>
            请确认生成费用和规则，开始后将锁定积分。
          </DialogDescription>
        </DialogHeader>
        
        <div v-if="themeOffer?.offer" class="space-y-4 py-4">
          <div class="rounded-lg border bg-muted/50 p-4 space-y-3 text-sm">
            <div class="flex justify-between">
              <span class="text-muted-foreground">单张价格</span>
              <span>{{ themeOffer.offer.unitCredits }} 积分</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">生成数量</span>
              <span>{{ requestedCount }} 张</span>
            </div>
            <div class="flex justify-between font-medium pt-2 border-t">
              <span>最高锁定积分</span>
              <span class="text-primary">{{ themeOffer.offer.maxCredits }} 积分</span>
            </div>
          </div>
          <p class="text-xs text-muted-foreground bg-amber-500/10 text-amber-600 p-3 rounded-md">
            结算说明：按实际成功生成的数量进行扣费。生成失败的张数将在任务结束后退回积分。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="confirmDialogOpen = false" :disabled="creatingJob">取消</Button>
          <Button @click="handleConfirm" :disabled="creatingJob">
            <Loader2 v-if="creatingJob" class="mr-2 size-4 animate-spin" />
            确认生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SelectionShell>
</template>
