<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Check, CircleCheck, CircleAlert, ChevronDown, Shuffle } from 'lucide-vue-next'
import { cva } from 'class-variance-authority'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { appLocale } from '@/plugins/i18n'
import SchemeGallery from './SchemeGallery.vue'
import type { MatchItem, Option } from './types'

const props = defineProps<{ item: MatchItem; index: number; preview?: boolean; searchId?: string; productSystems?: Option[] }>()
const emit = defineEmits<{ 'answer-applicability': [id: string, value: boolean] }>()
const { t } = useI18n()
const active = defineModel<number>('active', { default: 0 })
const reasonsExpanded = ref(false)
const reasonsId = useId()
const dimensions = computed(() => {
  const spec = props.item.specifications
  return `${spec.lengthMm / 1000} × ${spec.widthMm / 1000} m`
})
function productSystemLabel(id: string, fallback: string) {
  const labelKey: Record<string, string> = { fs62: 'controls.productSystemFs62', fs80: 'controls.productSystemFs80', truss: 'controls.productSystemTruss' }
  const option = props.productSystems?.find(option => option.id === id)
  return option?.labels?.[appLocale.value] || (appLocale.value !== 'zh' ? option?.labels?.en : undefined) || option?.label || (labelKey[id] ? t(labelKey[id]) : fallback || id)
}
const pendingConfirmations = computed(() => props.item.pendingConfirmations.filter(pending =>
  props.item.matchType !== 'random' || pending.type !== 'missing_field' || !!pending.field,
))
const visibleReasons = computed(() => props.item.reasons.slice(0, 3))
const remainingReasons = computed(() => props.item.reasons.slice(3))
const matchStatus = computed(() => ({
  direct: { label: t('schemeCard.matchDirect'), icon: CircleCheck },
  reference: { label: t('schemeCard.matchReference'), icon: CircleAlert },
  random: { label: t('schemeCard.matchRandom'), icon: Shuffle },
} satisfies Record<MatchItem['matchType'], { label: string; icon: typeof CircleCheck }>))
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
  <article class="border-t py-7 md:py-9" :aria-labelledby="`${reasonsId}-title`">
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-9">
      <div class="min-w-0 lg:sticky lg:top-24">
        <SchemeGallery v-model:active="active" :images="item.images" :code="item.code" :preview="preview" :variant="index" />
      </div>
      <div class="flex min-w-0 flex-col gap-5">
        <div class="flex items-center justify-between gap-3">
          <Badge variant="outline" :class="matchBadge({ type: item.matchType })">
            <component :is="matchStatus[item.matchType].icon" class="size-3.5" aria-hidden="true" />
            {{ matchStatus[item.matchType].label }}
          </Badge>
          <span class="font-mono text-xs text-muted-foreground" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
        </div>
        <div class="space-y-3">
          <h3 :id="`${reasonsId}-title`" class="flex flex-wrap items-baseline gap-x-2 gap-y-1 break-words text-xl font-semibold leading-snug tracking-tight">
            <bdi dir="ltr">{{ dimensions }}</bdi>
            <span aria-hidden="true">·</span>
            <i18n-t keypath="schemeDetail.boothTitle" scope="global" tag="span"><template #code><bdi>{{ productSystemLabel(item.specifications.productSystemId, item.specifications.productSystemLabel) }}</bdi></template></i18n-t>
          </h3>
          <p class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{{ t('schemeCard.openingCount', { count: item.specifications.openingCount }) }}</span>
            <bdi dir="ltr">{{ item.specifications.areaM2 }} m²</bdi>
            <i18n-t keypath="searches.heightLabel" scope="global" tag="span"><template #value><bdi dir="ltr">{{ item.specifications.heightMm / 1000 }}</bdi></template></i18n-t>
          </p>
          <p class="break-all text-xs text-muted-foreground">{{ t('schemeCard.schemeCode') }} <bdi dir="ltr" class="font-mono">{{ item.code }}</bdi></p>
        </div>
        <section v-if="item.reasons.length" class="space-y-3 border-t pt-4" :aria-label="item.matchType === 'random' ? t('schemeCard.referenceTitle') : t('schemeCard.reasonsTitle')">
          <h4 class="text-sm font-semibold">{{ item.matchType === 'random' ? t('schemeCard.referenceTitle') : t('schemeCard.reasonsTitle') }}</h4>
          <ul class="space-y-2 text-sm">
            <li v-for="reason in visibleReasons" :key="reason" class="flex gap-2 leading-relaxed"><Check class="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="min-w-0 break-words">{{ reason }}</span></li>
          </ul>
          <template v-if="remainingReasons.length">
            <ul v-show="reasonsExpanded" :id="reasonsId" class="space-y-2 text-sm">
              <li v-for="reason in remainingReasons" :key="reason" class="flex gap-2 leading-relaxed"><Check class="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="min-w-0 break-words">{{ reason }}</span></li>
            </ul>
            <Button variant="ghost" size="sm" class="-ms-2 h-auto whitespace-normal px-2 py-2 text-muted-foreground" :aria-expanded="reasonsExpanded" :aria-controls="reasonsId" @click="reasonsExpanded = !reasonsExpanded">
              {{ reasonsExpanded ? t('schemeCard.collapseReasons') : t('schemeCard.expandReasons', { count: remainingReasons.length }) }}
              <ChevronDown :class="cn('ms-1.5 size-4 shrink-0', reasonsExpanded && 'rotate-180')" aria-hidden="true" />
            </Button>
          </template>
        </section>
        <section class="space-y-3 border-t pt-4 text-sm leading-relaxed" :aria-label="t('schemeCard.differencesTitle')">
          <h4 class="font-semibold">{{ t('schemeCard.differencesTitle') }}</h4>
          <div v-if="item.differences.length" class="space-y-3 border-s-2 border-warning/50 bg-warning/5 p-4">
            <p class="flex items-center gap-2 font-medium text-warning"><CircleAlert class="size-4 shrink-0" aria-hidden="true" />{{ t('schemeCard.structureDiff') }}</p>
            <div v-for="difference in item.differences" :key="difference.field" class="space-y-1 break-words">
              <p><span class="text-muted-foreground">{{ t('schemeCard.yourRequirement') }}</span>{{ difference.requested }}</p>
              <p><span class="text-muted-foreground">{{ t('schemeCard.thisSolution') }}</span>{{ difference.actual }}</p>
              <p class="text-muted-foreground">{{ difference.reason }}</p>
            </div>
          </div>
          <p v-else class="text-muted-foreground">{{ item.matchType === 'random' ? t('schemeCard.randomNote') : t('schemeCard.noDifference') }}</p>
          <p v-if="item.matchType === 'random'" class="text-muted-foreground">{{ t('selection.missingFieldsNotice') }}</p>
          <div v-for="pending in pendingConfirmations" :key="pending.type === 'applicability_question' ? pending.id : pending.message" class="break-words">
            <div v-if="pending.type === 'applicability_question' && pending.id" role="group" :aria-label="pending.label ?? pending.message" class="space-y-2 rounded-md bg-muted/50 p-3">
              <p class="font-medium">{{ pending.label ?? pending.message }}</p>
              <p v-if="pending.helpText" class="text-muted-foreground">{{ pending.helpText }}</p>
              <div class="flex gap-2 pt-1">
                <Button size="sm" variant="outline" class="min-h-10 min-w-14" :disabled="preview" @click="emit('answer-applicability', pending.id!, true)">{{ t('common.yes') }}</Button>
                <Button size="sm" variant="outline" class="min-h-10 min-w-14" :disabled="preview" @click="emit('answer-applicability', pending.id!, false)">{{ t('common.no') }}</Button>
              </div>
            </div>
            <p v-else class="text-muted-foreground">{{ pending.message }}</p>
          </div>
          <p v-for="miss in item.preferenceMisses" :key="miss" class="break-words text-muted-foreground">{{ t('schemeCard.preferenceHint') }}{{ miss }}</p>
        </section>
        <Button as-child class="mt-auto justify-between gap-3" :aria-label="`${t('schemeCard.viewSolution')} ${item.code}`">
          <RouterLink :to="{ path: `${preview ? '/ai-selection/preview/schemes' : '/schemes'}/${encodeURIComponent(item.code)}`, query: !preview && searchId ? { searchId } : {} }">{{ t('schemeCard.viewSolution') }}<ArrowUpRight class="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" /></RouterLink>
        </Button>
      </div>
    </div>
  </article>
</template>
