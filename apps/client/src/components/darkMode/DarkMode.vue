<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next'
import { ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { type DarkModeVariants, darkModeVariants } from '.'
import { useI18n } from 'vue-i18n'

interface Props extends /* @vue-ignore */ DarkModeVariants {
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'ghost',
  size: 'default'
})

const isDark = ref(document.documentElement.classList.contains('dark'))
const { t } = useI18n()

const toggleDarkMode = () => {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('darkMode', String(isDark.value))
}
</script>

<template>
  <button
    type="button"
    :class="cn(darkModeVariants({ variant: props.variant, size: props.size }), props.class)"
    :aria-label="isDark ? t('appearance.lightMode') : t('appearance.darkMode')"
    @click="toggleDarkMode"
  >
    <Sun v-if="!isDark" class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
    <Moon v-else class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
  </button>
</template>
