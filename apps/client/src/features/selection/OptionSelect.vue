<script setup lang="ts">
import { computed } from 'vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Option } from './types'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ modelValue: string | null; options: Option[]; label: string; placeholder?: string; disabled?: boolean }>()
const { t } = useI18n()
const placeholder = computed(() => props.placeholder ?? t('controls.unlimited'))
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
</script>

<template>
  <Select :model-value="props.modelValue ?? '__unset'" :disabled="props.disabled" @update:model-value="emit('update:modelValue', $event === '__unset' ? null : $event)">
    <SelectTrigger :aria-label="props.label"><SelectValue :placeholder="placeholder" /></SelectTrigger>
    <SelectContent><SelectItem value="__unset">{{ placeholder }}</SelectItem><SelectItem v-for="option in props.options" :key="option.id" :value="option.id">{{ option.label }}</SelectItem></SelectContent>
  </Select>
</template>
