<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import OptionSelect from './OptionSelect.vue'
import type { Catalog, Requirement } from './types'

const props = defineProps<{ modelValue: Requirement; field: keyof Requirement; catalog: Catalog; disabled?: boolean; id: string; inline?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Requirement] }>()
const { t } = useI18n()
const numericFields = ['lengthMm', 'widthMm', 'maxHeightMm', 'areaM2']
const isSelect = computed(() => ['boothSpaceId', 'openingCount', 'productSystemId', 'budgetTierId'].includes(props.field))
const labels = computed((): Record<keyof Requirement, string> => ({
  boothSpaceId: t('requirementForm.fieldBoothSpaceId'),
  lengthMm: t('requirementForm.fieldLengthMm'),
  widthMm: t('requirementForm.fieldWidthMm'),
  maxHeightMm: t('requirementForm.fieldMaxHeightMm'),
  areaM2: t('requirementForm.fieldAreaM2'),
  openingCount: t('requirementForm.fieldOpeningCount'),
  productSystemId: t('requirementForm.fieldProductSystemId'),
  budgetTierId: t('requirementForm.fieldBudgetTierId'),
  styleIds: t('requirementForm.fieldStyleIds'),
  industryIds: t('requirementForm.fieldIndustryIds'),
  zoneIds: t('requirementForm.fieldZoneIds'),
  featureIds: t('requirementForm.fieldFeatureIds'),
  requiredZoneIds: t('requirementForm.fieldRequiredZoneIds'),
  excludedZoneIds: t('requirementForm.fieldExcludedZoneIds'),
  requiredFeatureIds: t('requirementForm.fieldRequiredFeatureIds'),
  excludedFeatureIds: t('requirementForm.fieldExcludedFeatureIds'),
  keywords: t('requirementForm.fieldKeywords'),
  applicabilityAnswers: t('requirementForm.fieldApplicabilityAnswers'),
}))
const options = computed(() => {
  switch (props.field) {
    case 'boothSpaceId': return props.catalog.boothSpaces
    case 'openingCount': return props.catalog.openingCounts
    case 'productSystemId': return props.catalog.productSystems
    case 'budgetTierId': return props.catalog.budgetTiers
    case 'styleIds': return props.catalog.styles
    case 'industryIds': return props.catalog.industries
    case 'zoneIds': case 'requiredZoneIds': case 'excludedZoneIds': return props.catalog.zones
    case 'featureIds': case 'requiredFeatureIds': case 'excludedFeatureIds': return props.catalog.features
    default: return []
  }
})
const numericValue = computed(() => {
  const value = props.modelValue[props.field]
  return typeof value === 'number' ? value / (props.field === 'areaM2' ? 1 : 1000) : ''
})
const numericError = computed(() => {
  if (!numericFields.includes(props.field)) return ''
  const value = props.modelValue[props.field] as number | null
  if (value === null) return ''
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return props.field === 'areaM2' ? t('requirementForm.validationArea') : t('requirementForm.validationRange')
  if (props.field !== 'areaM2' && !Number.isInteger(value)) return t('requirementForm.validationDecimal')
  return ''
})
function update(value: Requirement[keyof Requirement]) {
  const next = { ...props.modelValue, [props.field]: value }
  if (props.field === 'lengthMm' || props.field === 'widthMm') {
    next.boothSpaceId = null
    next.areaM2 = next.lengthMm && next.widthMm ? Number((next.lengthMm * next.widthMm / 1_000_000).toFixed(6)) : null
  }
  if (props.field === 'boothSpaceId') {
    const size = props.catalog.boothSpaces.find(space => space.id === value)
    next.lengthMm = size?.lengthMm ?? null
    next.widthMm = size?.widthMm ?? null
    next.areaM2 = size ? size.lengthMm * size.widthMm / 1_000_000 : null
  }
  emit('update:modelValue', next)
}
function updateNumber(value: string | number) {
  update(value === '' ? null : Number((Number(value) * (props.field === 'areaM2' ? 1 : 1000)).toFixed(6)))
}
function toggle(id: string) {
  const values = props.modelValue[props.field] as string[]
  update(values.includes(id) ? values.filter(value => value !== id) : [...values, id])
}
function answer(id: string, value: string | null) {
  const answers = { ...props.modelValue.applicabilityAnswers }
  if (value === null) delete answers[id]
  else answers[id] = value === 'true'
  update(answers)
}
</script>

<template>
  <div :class="cn('min-w-0', inline ? 'grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start sm:gap-4' : 'space-y-2')">
    <Label :for="numericFields.includes(field) || field === 'keywords' ? id : undefined" :class="cn(inline && 'sm:leading-5 sm:text-muted-foreground', inline && (isSelect ? 'sm:pt-3' : 'sm:pt-2'))">{{ labels[field] }}</Label>
    <template v-if="numericFields.includes(field)"><Input :id="id" type="number" inputmode="decimal" :min="field === 'areaM2' ? 0.000001 : 0.001" :max="field === 'areaM2' ? 1000000 : 1000" :step="field === 'areaM2' ? 0.000001 : 0.001" :model-value="numericValue" :disabled="disabled" :aria-invalid="!!numericError" :aria-describedby="numericError ? `${id}-error` : undefined" :placeholder="t('requirementForm.fieldPlaceholder')" @update:model-value="updateNumber" /><p v-if="numericError" :id="`${id}-error`" class="text-xs text-destructive">{{ numericError }}</p></template>
    <div v-else-if="isSelect" :class="cn(inline && 'sm:max-w-xs')"><OptionSelect :label="labels[field]" :model-value="modelValue[field] === null ? null : String(modelValue[field])" :options="options" :disabled="disabled" @update:model-value="update(field === 'openingCount' && $event !== null ? Number($event) : $event)" /></div>
    <div v-else class="flex flex-wrap gap-2">
      <Button v-for="option in options" :key="option.id" type="button" size="sm" :disabled="disabled" :variant="(modelValue[field] as string[]).includes(option.id) ? 'selected' : 'outline'" :aria-pressed="(modelValue[field] as string[]).includes(option.id)" @click="toggle(option.id)"><Check v-if="(modelValue[field] as string[]).includes(option.id)" aria-hidden="true" />{{ option.label }}</Button>
      <p v-if="!options.length" class="text-xs text-muted-foreground">{{ t('requirementForm.fieldNoOptions') }}</p>
    </div>
  </div>
</template>
