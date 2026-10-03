<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ArrowUpRight, Check, CircleCheck, CircleAlert, ChevronDown, Shuffle } from 'lucide-vue-next'
import { cva } from 'class-variance-authority'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import SchemeGallery from './SchemeGallery.vue'
import type { MatchItem } from './types'

const props = defineProps<{ item: MatchItem; index: number; preview?: boolean; searchId?: string }>()
const emit = defineEmits<{ 'answer-applicability': [id: string, value: boolean] }>()
const active = defineModel<number>('active', { default: 0 })
const reasonsExpanded = ref(false)
const reasonsId = useId()
const title = computed(() => {
  const spec = props.item.specifications
  return `${spec.lengthMm / 1000} × ${spec.widthMm / 1000} m · ${spec.productSystemLabel}展台`
})
const visibleReasons = computed(() => props.item.reasons.slice(0, 3))
const remainingReasons = computed(() => props.item.reasons.slice(3))
const matchStatus = {
  direct: { label: '可直接采用', icon: CircleCheck },
  reference: { label: '相似参考', icon: CircleAlert },
  random: { label: '随机推荐', icon: Shuffle },
} satisfies Record<MatchItem['matchType'], { label: string; icon: typeof CircleCheck }>
const matchBadge = cva('gap-1.5 px-2.5 py-1 text-xs font-medium hover:bg-transparent', {
  variants: {
    type: {
      direct: 'border-success/25 bg-success/10 text-success',
      reference: 'border-warning/25 bg-warning/10 text-warning',
      random: 'border-info/25 bg-info/10 text-info',
    },
  },
})
watch(() => props.item, () => { reasonsExpanded.value = false })
</script>

<template>
  <Card class="overflow-hidden shadow-none">
    <CardContent class="grid gap-0 p-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div class="min-w-0 bg-muted/30 p-3 sm:p-5 lg:p-6">
        <SchemeGallery v-model:active="active" :images="item.images" :code="item.code" :preview="preview" :variant="index" />
      </div>
      <div class="flex min-w-0 flex-col gap-5 p-5 sm:p-6 lg:p-7">
        <div class="flex items-center justify-between gap-3">
          <Badge variant="outline" :class="matchBadge({ type: item.matchType })">
            <component :is="matchStatus[item.matchType].icon" class="size-3.5" aria-hidden="true" />
            {{ matchStatus[item.matchType].label }}
          </Badge>
          <span class="font-mono text-xs text-muted-foreground" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
        </div>
        <div class="space-y-3">
          <h3 class="break-words text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{{ title }}</h3>
          <p class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{{ item.specifications.openingCount }} 面开口</span>
            <span>{{ item.specifications.areaM2 }} ㎡</span>
            <span>高 {{ item.specifications.heightMm / 1000 }} m</span>
          </p>
          <p class="break-all text-xs text-muted-foreground">方案编号 <span class="font-mono">{{ item.code }}</span></p>
        </div>
        <section v-if="item.reasons.length" class="space-y-3 border-t pt-4" :aria-label="item.matchType === 'random' ? '方案参考信息' : '为什么适合您'">
          <h4 class="text-sm font-semibold">{{ item.matchType === 'random' ? '方案参考信息' : '为什么适合您' }}</h4>
          <ul class="space-y-2 text-sm">
            <li v-for="reason in visibleReasons" :key="reason" class="flex gap-2 leading-relaxed"><Check class="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="min-w-0 break-words">{{ reason }}</span></li>
          </ul>
          <template v-if="remainingReasons.length">
            <ul v-show="reasonsExpanded" :id="reasonsId" class="space-y-2 text-sm">
              <li v-for="reason in remainingReasons" :key="reason" class="flex gap-2 leading-relaxed"><Check class="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="min-w-0 break-words">{{ reason }}</span></li>
            </ul>
            <Button variant="ghost" size="sm" class="-ml-2 h-auto whitespace-normal px-2 py-2 text-muted-foreground" :aria-expanded="reasonsExpanded" :aria-controls="reasonsId" @click="reasonsExpanded = !reasonsExpanded">
              {{ reasonsExpanded ? '收起匹配理由' : `展开其余 ${remainingReasons.length} 条理由` }}
              <ChevronDown :class="cn('ml-1.5 size-4 shrink-0', reasonsExpanded && 'rotate-180')" aria-hidden="true" />
            </Button>
          </template>
        </section>
        <section class="space-y-3 border-t pt-4 text-sm leading-relaxed" aria-label="需要确认的差异">
          <h4 class="font-semibold">需要确认的差异</h4>
          <div v-if="item.differences.length" class="space-y-3 rounded-md border border-warning/25 bg-warning/5 p-3">
            <p class="flex items-center gap-2 font-medium text-warning"><CircleAlert class="size-4 shrink-0" aria-hidden="true" />结构差异</p>
            <div v-for="difference in item.differences" :key="difference.field" class="space-y-1 break-words">
              <p><span class="text-muted-foreground">您的需求：</span>{{ difference.requested }}</p>
              <p><span class="text-muted-foreground">此方案：</span>{{ difference.actual }}</p>
              <p class="text-muted-foreground">{{ difference.reason }}</p>
            </div>
          </div>
          <p v-else class="text-muted-foreground">{{ item.matchType === 'random' ? '随机推荐，尺寸、开口与适用条件需进一步确认。' : '当前匹配未列出结构差异。' }}</p>
          <div v-for="pending in item.pendingConfirmations" :key="pending.type === 'applicability_question' ? pending.id : pending.message" class="break-words">
            <div v-if="pending.type === 'applicability_question' && pending.id" role="group" :aria-label="pending.label ?? pending.message" class="space-y-2 rounded-md bg-muted/50 p-3">
              <p class="font-medium">{{ pending.label ?? pending.message }}</p>
              <p v-if="pending.helpText" class="text-muted-foreground">{{ pending.helpText }}</p>
              <div class="flex gap-2 pt-1">
                <Button size="sm" variant="outline" class="min-h-10 min-w-14" :disabled="preview" @click="emit('answer-applicability', pending.id!, true)">是</Button>
                <Button size="sm" variant="outline" class="min-h-10 min-w-14" :disabled="preview" @click="emit('answer-applicability', pending.id!, false)">否</Button>
              </div>
            </div>
            <p v-else class="text-muted-foreground">{{ pending.message }}</p>
          </div>
          <p v-for="miss in item.preferenceMisses" :key="miss" class="break-words text-muted-foreground">偏好提示：{{ miss }}</p>
        </section>
        <Button as-child class="mt-auto justify-between gap-3" :aria-label="`查看方案 ${item.code}`">
          <RouterLink :to="{ path: `${preview ? '/ai-selection/preview/schemes' : '/schemes'}/${encodeURIComponent(item.code)}`, query: !preview && searchId ? { searchId } : {} }">查看方案<ArrowUpRight class="size-4" aria-hidden="true" /></RouterLink>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
