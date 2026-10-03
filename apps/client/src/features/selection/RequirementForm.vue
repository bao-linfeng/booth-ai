<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw, SlidersHorizontal } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import OptionSelect from './OptionSelect.vue'
import RequirementField from './RequirementField.vue'
import type { Catalog, Requirement } from './types'

const props = defineProps<{ modelValue: Requirement; catalog: Catalog; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Requirement]; reset: [] }>()
const commonSizes = computed(() => [...new Map(props.catalog.boothSpaces.map(space => {
  const id = `${space.lengthMm}-${space.widthMm}`
  return [id, { id, label: `${space.lengthMm / 1000} × ${space.widthMm / 1000} m`, lengthMm: space.lengthMm, widthMm: space.widthMm }]
})).values()])
const selectedSize = computed(() => commonSizes.value.find(size => size.lengthMm === props.modelValue.lengthMm && size.widthMm === props.modelValue.widthMm)?.id ?? null)
const moreFields = ['productSystemId', 'budgetTierId', 'styleIds', 'industryIds', 'zoneIds', 'featureIds'] as const
const moreCount = computed(() => moreFields.filter(field => {
  const value = props.modelValue[field]
  return Array.isArray(value) ? value.length > 0 : value !== null
}).length)
function selectSize(id: string | null) {
  const size = commonSizes.value.find(item => item.id === id)
  emit('update:modelValue', { ...props.modelValue, lengthMm: size?.lengthMm ?? null, widthMm: size?.widthMm ?? null, areaM2: size ? size.lengthMm * size.widthMm / 1_000_000 : null })
}
</script>

<template>
  <fieldset :disabled="disabled" class="min-w-0 space-y-5">
    <legend class="sr-only">展位条件</legend>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-sm font-medium">展位条件 <span class="font-normal text-muted-foreground">· 选填</span></h3>
      <div class="w-full sm:w-52"><OptionSelect label="常用尺寸" placeholder="不选常用尺寸" :disabled="disabled" :model-value="selectedSize" :options="commonSizes" @update:model-value="selectSize" /></div>
    </div>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <RequirementField v-for="field in (['lengthMm', 'widthMm', 'openingCount', 'maxHeightMm'] as const)" :id="`requirement-${field}`" :key="field" :field="field" :model-value="modelValue" :catalog="catalog" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)" />
    </div>
    <p class="text-xs leading-relaxed text-muted-foreground"><span v-if="modelValue.areaM2">面积 {{ modelValue.areaM2 }} ㎡ · </span>长为左右跨度，宽为前后进深。限高按场馆规定独立填写，常用尺寸不会代填限高。</p>
    <Accordion type="single" collapsible>
      <AccordionItem value="more" class="border-b-0 border-t">
        <AccordionTrigger class="text-sm hover:no-underline"><span class="flex items-center gap-2"><SlidersHorizontal class="size-4" />更多条件<span class="font-normal text-muted-foreground">{{ moreCount ? `已填 ${moreCount} 类` : '体系、风格、行业与预算' }}</span></span></AccordionTrigger>
        <AccordionContent class="space-y-6 pt-2">
          <div class="grid gap-6 sm:grid-cols-2">
            <RequirementField v-for="field in moreFields" :id="`requirement-${field}`" :key="field" :field="field" :model-value="modelValue" :catalog="catalog" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)" />
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">产品体系用于严格筛选；风格、行业、功能分区和材料预算用于排序。材料预算不含搭建、运输等费用，不代表实际报价。</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    <div class="flex justify-end"><Button type="button" variant="ghost" size="sm" :disabled="disabled" @click="emit('reset')"><RotateCcw class="mr-1 size-3.5" />重置全部需求</Button></div>
  </fieldset>
</template>
