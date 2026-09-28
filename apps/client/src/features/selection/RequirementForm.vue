<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw, SlidersHorizontal } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import OptionSelect from './OptionSelect.vue'
import type { Catalog, Requirement } from './types'

const props = defineProps<{ modelValue: Requirement; catalog: Catalog; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Requirement]; reset: [] }>()
const selectedBoothSpaceId = computed(() => {
  const { lengthMm, widthMm, maxHeightMm } = props.modelValue
  return props.catalog.boothSpaces.find(space => space.lengthMm === lengthMm && space.widthMm === widthMm && space.heightMm === maxHeightMm)?.id ?? null
})
const areaValue = computed(() => {
  const { lengthMm, widthMm } = props.modelValue
  return lengthMm && widthMm ? lengthMm * widthMm / 1_000_000 : null
})
function update<K extends keyof Requirement>(key: K, value: Requirement[K]) {
  const next = { ...props.modelValue, [key]: value }
  if (key === 'lengthMm' || key === 'widthMm') next.areaM2 = next.lengthMm && next.widthMm ? next.lengthMm * next.widthMm / 1000000 : null
  emit('update:modelValue', next)
}
function updateBoothSpace(id: string | null) {
  const space = props.catalog.boothSpaces.find(item => item.id === id)
  if (!space) {
    emit('update:modelValue', { ...props.modelValue, lengthMm: null, widthMm: null, maxHeightMm: null, areaM2: null })
    return
  }
  emit('update:modelValue', {
    ...props.modelValue,
    lengthMm: space.lengthMm,
    widthMm: space.widthMm,
    maxHeightMm: space.heightMm,
    areaM2: space.lengthMm * space.widthMm / 1_000_000,
  })
}
function toggle(key: 'styleIds' | 'industryIds' | 'zoneIds' | 'featureIds', id: string) {
  const current = props.modelValue[key]
  update(key, current.includes(id) ? current.filter(item => item !== id) : [...current, id])
}
function answer(id: string, value: string | null) {
  const answers = { ...props.modelValue.applicabilityAnswers }
  if (value === null) delete answers[id]
  else answers[id] = value === 'true'
  update('applicabilityAnswers', answers)
}
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-center justify-between space-y-0 pb-4">
      <CardTitle class="flex items-center gap-2 text-base"><SlidersHorizontal class="size-4" />选型条件</CardTitle>
      <Button variant="ghost" size="sm" :disabled="disabled" @click="emit('reset')"><RotateCcw class="mr-1 size-3.5" />重置</Button>
    </CardHeader>
    <CardContent class="space-y-6">
      <fieldset :disabled="disabled" class="min-w-0 space-y-6">
        <section class="space-y-4">
           <h3 class="text-sm font-medium">展位空间</h3>
           <div class="grid gap-4">
              <div class="space-y-2"><Label>展位空间</Label><OptionSelect label="展位空间" placeholder="不限" :disabled="disabled" :model-value="selectedBoothSpaceId" :options="catalog.boothSpaces" @update:model-value="updateBoothSpace" /><p class="text-xs text-muted-foreground">长 × 宽 × 高，按已导入方案的真实组合选择</p></div>
              <div class="space-y-2"><Label for="booth-area">面积 <span class="text-xs text-muted-foreground">/ ㎡</span></Label><Input id="booth-area" :model-value="areaValue === null ? '' : String(areaValue)" readonly aria-readonly="true" placeholder="选择展位空间后自动计算" /><p class="text-xs text-muted-foreground">根据所选长宽自动计算，不可修改</p></div>
           </div>
           <div class="space-y-2"><Label>开口面数</Label><OptionSelect label="开口面数" placeholder="暂不确定" :disabled="disabled" :model-value="modelValue.openingCount === null ? null : String(modelValue.openingCount)" :options="catalog.openingCounts" @update:model-value="update('openingCount', $event ? Number($event) : null)" /></div>
        </section>
        <Separator />
         <section class="space-y-4"><h3 class="text-sm font-medium">体系与偏好</h3><div class="space-y-2"><Label>产品体系</Label><OptionSelect label="产品体系" :disabled="disabled" :model-value="modelValue.productSystemId" :options="catalog.productSystems" @update:model-value="update('productSystemId', $event)" /><p class="text-xs text-muted-foreground">指定体系后严格筛选</p></div>
           <div v-for="group in ([{ key: 'styleIds', label: '设计风格', options: catalog.styles }, { key: 'industryIds', label: '适用行业', options: catalog.industries }, { key: 'zoneIds', label: '功能分区', options: catalog.zones }, { key: 'featureIds', label: '特色功能', options: catalog.features }] as const)" :key="group.key" class="space-y-2"><Label>{{ group.label }} <span class="font-normal text-muted-foreground">· 多选偏好</span></Label><div class="flex flex-wrap gap-2"><Button size="sm" :variant="modelValue[group.key].length ? 'outline' : 'secondary'" :aria-pressed="!modelValue[group.key].length" @click="update(group.key, [])">不限</Button><Button v-for="option in group.options" :key="option.id" size="sm" :variant="modelValue[group.key].includes(option.id) ? 'secondary' : 'outline'" :aria-pressed="modelValue[group.key].includes(option.id)" @click="toggle(group.key, option.id)">{{ option.label }}</Button></div></div>
          <div class="space-y-2"><Label>材料购买预算</Label><OptionSelect label="材料购买预算" :disabled="disabled" :model-value="modelValue.budgetTierId" :options="catalog.budgetTiers" @update:model-value="update('budgetTierId', $event)" /><p class="text-xs leading-relaxed text-muted-foreground">仅材料购买预算，不含搭建、运输等费用，不代表实际报价。</p></div>
        </section>
        <Accordion v-if="catalog.applicabilityQuestions.length" type="single" collapsible><AccordionItem value="applicability" class="border-b-0"><AccordionTrigger class="text-sm">补充适用条件</AccordionTrigger><AccordionContent class="space-y-4"><div v-for="question in catalog.applicabilityQuestions" :key="question.id" class="space-y-2"><Label>{{ question.label }}</Label><OptionSelect :label="question.label" placeholder="暂不清楚" :disabled="disabled" :model-value="modelValue.applicabilityAnswers[question.id] === undefined ? null : String(modelValue.applicabilityAnswers[question.id])" :options="[{ id: 'true', label: '是' }, { id: 'false', label: '否' }]" @update:model-value="answer(question.id, $event)" /><p class="text-xs text-muted-foreground">{{ question.helpText }}</p></div></AccordionContent></AccordionItem></Accordion>
      </fieldset>
    </CardContent>
  </Card>
</template>
