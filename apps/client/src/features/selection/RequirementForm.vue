<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal } from 'lucide-vue-next'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import OptionSelect from './OptionSelect.vue'
import RequirementField from './RequirementField.vue'
import type { Catalog, Requirement } from './types'

const props = defineProps<{ modelValue: Requirement; catalog: Catalog; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Requirement] }>()
const { t } = useI18n()
const commonSizes = computed(() => props.catalog.boothSpaces)
const selectedSize = computed(() => props.modelValue.boothSpaceId)
const moreFields = ['maxHeightMm', 'productSystemId', 'styleIds', 'industryIds', 'zoneIds', 'featureIds', 'budgetTierId'] as const
const moreCount = computed(() => moreFields.filter(field => {
  const value = props.modelValue[field]
  return Array.isArray(value) ? value.length > 0 : value !== null
}).length)
function selectSize(id: string | null) {
  const size = commonSizes.value.find(item => item.id === id)
  emit('update:modelValue', { ...props.modelValue, boothSpaceId: size?.id ?? null, lengthMm: size?.lengthMm ?? null, widthMm: size?.widthMm ?? null, areaM2: size ? size.lengthMm * size.widthMm / 1_000_000 : null })
}
</script>

<template>
  <fieldset :disabled="disabled" class="min-w-0 space-y-3">
    <legend class="sr-only">{{ t('requirementForm.legend') }}</legend>
    <h3 class="text-sm font-medium">{{ t('requirementForm.title') }} <span class="font-normal text-muted-foreground">{{ t('requirementForm.optional') }}</span></h3>
    <div class="grid grid-cols-2 gap-3 sm:gap-4">
      <div class="min-w-0 space-y-2">
        <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{{ t('requirementForm.sizeLabel') }}</label>
        <OptionSelect :label="t('requirementForm.boothSpaceSelectLabel')" :placeholder="t('requirementForm.sizePlaceholder')" :disabled="disabled" :model-value="selectedSize" :options="commonSizes" @update:model-value="selectSize" />
      </div>
      <RequirementField :id="`requirement-openingCount`" field="openingCount" :model-value="modelValue" :catalog="catalog" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)" />
    </div>
    <p v-if="modelValue.areaM2" class="text-xs text-muted-foreground">{{ t('requirementForm.areaHint', { value: modelValue.areaM2 }) }}</p>
    <Accordion type="single" collapsible>
      <AccordionItem value="more" class="border-b-0 border-t">
        <AccordionTrigger class="py-3 text-sm hover:no-underline"><span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><SlidersHorizontal class="size-4 shrink-0" />{{ t('requirementForm.moreConditions') }}<span class="text-xs font-normal text-muted-foreground">{{ moreCount ? t('requirementForm.moreCount', { count: moreCount }) : t('requirementForm.morePlaceholder') }}</span></span></AccordionTrigger>
        <AccordionContent class="space-y-6 pt-2">
          <div class="grid gap-6 sm:grid-cols-2">
            <RequirementField v-for="field in moreFields" :id="`requirement-${field}`" :key="field" :field="field" :model-value="modelValue" :catalog="catalog" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)" />
          </div>
          <p class="text-xs leading-6 text-muted-foreground">{{ t('requirementForm.moreNote') }}</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </fieldset>
</template>
