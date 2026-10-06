<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarDate, DateFormatter, getLocalTimeZone, parseDate, today } from '@internationalized/date'
import type { DateValue } from '@internationalized/date'
import { CalendarCell, CalendarCellTrigger, CalendarGrid, CalendarGridBody, CalendarGridHead, CalendarGridRow, CalendarHeadCell, CalendarHeader, CalendarHeading, CalendarNext, CalendarPrev, CalendarRoot, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'radix-vue'
import { CalendarIcon } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import { appLocale } from '@/plugins/i18n'
import { useI18n } from 'vue-i18n'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  required?: boolean
  min?: string
  disabled?: boolean
}>(), {
  placeholder: undefined,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()

const open = ref(false)

const df = computed(() => new DateFormatter(appLocale.value === 'zh' ? 'zh-CN' : appLocale.value, { dateStyle: 'medium' }))

const dateValue = computed<DateValue | undefined>(() => {
  try {
    return props.modelValue ? parseDate(props.modelValue) : undefined
  } catch {
    return undefined
  }
})

const minValue = computed<DateValue | undefined>(() => {
  try {
    return props.min ? parseDate(props.min) : undefined
  } catch {
    return undefined
  }
})

const displayText = computed(() =>
  dateValue.value
    ? df.value.format(dateValue.value.toDate(getLocalTimeZone()))
    : props.placeholder || t('controls.datePlaceholder')
)

function onSelect(val: DateValue | undefined) {
  if (!val) return
  const d = val as CalendarDate
  const iso = `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
  emit('update:modelValue', iso)
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child :disabled="disabled">
      <button
        v-bind="$attrs"
        type="button"
        :aria-required="required || undefined"
        :disabled="disabled"
        :class="cn(
          'flex h-11 w-full min-w-0 items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          !dateValue && 'text-muted-foreground'
        )"
      >
        <span>{{ displayText }}</span>
        <CalendarIcon class="h-4 w-4 opacity-50 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        align="start"
        :side-offset="4"
        class="z-50 w-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <CalendarRoot
          v-slot="{ grid, weekDays }"
          :model-value="dateValue"
          :min-value="minValue"
          :locale="appLocale === 'zh' ? 'zh-CN' : appLocale"
          class="p-3"
          @update:model-value="onSelect"
        >
          <CalendarHeader class="relative flex items-center justify-between mb-2">
            <CalendarPrev class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50">
              ‹
            </CalendarPrev>
            <CalendarHeading class="text-sm font-medium" />
            <CalendarNext class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50">
              ›
            </CalendarNext>
          </CalendarHeader>
          <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="w-full border-collapse">
            <CalendarGridHead>
              <CalendarGridRow class="flex">
                <CalendarHeadCell
                  v-for="day in weekDays"
                  :key="day"
                  class="w-8 text-center text-xs text-muted-foreground font-normal pb-1"
                >
                  {{ day }}
                </CalendarHeadCell>
              </CalendarGridRow>
            </CalendarGridHead>
            <CalendarGridBody>
              <CalendarGridRow
                v-for="(weekDates, i) in month.rows"
                :key="i"
                class="flex mt-1"
              >
                <CalendarCell
                  v-for="weekDate in weekDates"
                  :key="weekDate.toString()"
                  :date="weekDate"
                  class="p-0 text-center"
                >
                  <CalendarCellTrigger
                    :day="weekDate"
                    :month="month.value"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[today]:border data-[today]:border-primary data-[disabled]:opacity-30 data-[disabled]:pointer-events-none data-[outside-view]:opacity-30"
                  />
                </CalendarCell>
              </CalendarGridRow>
            </CalendarGridBody>
          </CalendarGrid>
        </CalendarRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
