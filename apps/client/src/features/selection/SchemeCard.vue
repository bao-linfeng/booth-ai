<script setup lang="ts">
import { ArrowUpRight, Check, CircleAlert } from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import SchemeGallery from './SchemeGallery.vue'
import type { MatchItem } from './types'

defineProps<{ item: MatchItem; index: number; preview?: boolean }>()
const active = defineModel<number>('active', { default: 0 })
</script>

<template>
  <Card class="overflow-hidden">
    <CardContent class="grid gap-5 p-4 xl:grid-cols-2 xl:p-5">
      <SchemeGallery v-model:active="active" :images="item.images" :code="item.code" :preview="preview" :variant="index" />
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <Badge :variant="item.matchType === 'direct' ? 'default' : 'secondary'">
            <Check v-if="item.matchType === 'direct'" class="mr-1 size-3" />
            <CircleAlert v-else class="mr-1 size-3" />
            {{ { direct: '可直接采用', reference: '相似参考', random: '随机推荐' }[item.matchType] }}
          </Badge>
          <span class="font-mono text-xs text-muted-foreground">{{ String(index + 1).padStart(2, '0') }}</span>
        </div>
        <h3 class="break-all font-mono text-lg font-semibold">{{ item.code }}</h3>
        <div class="flex flex-wrap items-baseline gap-3">
          <strong class="font-mono text-2xl font-medium">{{ item.specifications.lengthMm / 1000 }} × {{ item.specifications.widthMm / 1000 }} <small class="text-sm">m</small></strong>
          <span class="text-sm text-muted-foreground">{{ item.specifications.areaM2 }} ㎡ · 高 {{ item.specifications.heightMm / 1000 }} m</span>
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">{{ item.specifications.productSystemLabel }} · {{ item.specifications.openingCount }} 面开口</p>
        <Separator />
        <ul v-if="item.reasons.length" class="space-y-2 text-xs">
          <li v-for="reason in item.reasons" :key="reason" class="flex gap-2 leading-relaxed"><Check class="size-4 shrink-0 text-primary" />{{ reason }}</li>
        </ul>
        <div v-if="item.differences.length" class="space-y-3 rounded-md border bg-muted/50 p-3 text-xs">
          <strong class="flex items-center gap-2"><CircleAlert class="size-4" />结构差异</strong>
          <div v-for="difference in item.differences" :key="difference.field" class="space-y-1">
            <p>{{ difference.requested }} → {{ difference.actual }}</p>
            <p class="leading-relaxed text-muted-foreground">{{ difference.reason }}</p>
          </div>
        </div>
        <div v-if="item.pendingConfirmations.length" class="space-y-1 text-xs leading-relaxed">
          <strong>待确认</strong>
          <p v-for="pending in item.pendingConfirmations" :key="pending" class="text-muted-foreground">{{ pending }}</p>
        </div>
        <p v-if="item.matchType === 'random'" class="text-xs text-muted-foreground">随机推荐，适用条件待确认。</p>
        <p v-for="miss in item.preferenceMisses" :key="miss" class="text-xs text-muted-foreground">偏好提示：{{ miss }}</p>
        <Button as-child variant="outline" class="mt-auto justify-between">
          <RouterLink :to="{ path: `${preview ? '/ai-selection/preview/schemes' : '/schemes'}/${encodeURIComponent(item.code)}` }">查看方案详情<ArrowUpRight class="size-4" /></RouterLink>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
