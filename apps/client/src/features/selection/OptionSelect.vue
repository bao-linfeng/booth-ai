<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Option } from './types'
withDefaults(defineProps<{ modelValue: string | null; options: Option[]; label: string; placeholder?: string; disabled?: boolean }>(), { placeholder: '不限' })
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
</script>

<template>
  <Select :model-value="modelValue ?? '__unset'" :disabled="disabled" @update:model-value="emit('update:modelValue', $event === '__unset' ? null : $event)">
    <SelectTrigger :aria-label="label"><SelectValue :placeholder="placeholder" /></SelectTrigger>
    <SelectContent><SelectItem value="__unset">{{ placeholder }}</SelectItem><SelectItem v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</SelectItem></SelectContent>
  </Select>
</template>
