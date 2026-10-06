<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-vue-next'
import { ref } from 'vue'
import type { HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'

const isOpen = ref(false)
const { t } = useI18n()
defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetTrigger as-child><Button variant="ghost" size="icon" :aria-label="t('nav.openMenu')"><Menu class="h-5 w-5" /><span class="sr-only">{{ t('nav.openMenu') }}</span></Button></SheetTrigger>
    <SheetContent side="left" class="w-[280px] sm:w-[340px]">
      <SheetHeader><SheetTitle><slot name="title">{{ t('nav.mainNav') }}</slot></SheetTitle><SheetDescription><slot name="description">{{ t('nav.mobileNav') }}</slot></SheetDescription></SheetHeader>
      <div :class="cn('flex-1 overflow-y-auto px-4', $props.class)"><slot /></div>
      <SheetFooter><slot name="footer" /></SheetFooter>
    </SheetContent>
  </Sheet>
</template>
