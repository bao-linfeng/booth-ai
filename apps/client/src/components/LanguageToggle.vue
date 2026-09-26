<script setup lang="ts">
import { computed } from 'vue'
import type { Ref } from 'vue'
import { Languages } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAsyncState, useStorage } from '@vueuse/core'
import type { Language } from '@/plugins/i18n'
import { appLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/plugins/i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getLanguageList, type LanguageItem } from '@/services/api/language.api'

const { locale } = useI18n()

const cachedLanguages = useStorage<LanguageItem[]>('app-language-list', [])

const { state: languages, isLoading } = useAsyncState<LanguageItem[]>(
  cachedLanguages.value.length > 0
    ? Promise.resolve(cachedLanguages.value)
    : getLanguageList().then(res => {
        cachedLanguages.value = res.data
        return res.data
      }),
  cachedLanguages.value
)

const currentLocaleCode = computed(() => (appLocale as Ref<string>).value)
const currentLangAbbr = computed(() => (currentLocaleCode.value || DEFAULT_LOCALE).slice(0, 2).toUpperCase())

function setLocale(lang: string) {
  if (!SUPPORTED_LOCALES.has(lang as Language)) {
    locale.value = DEFAULT_LOCALE
    ;(appLocale as Ref<string>).value = lang
    return
  }
  locale.value = lang as Language
  ;(appLocale as Ref<string>).value = lang
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="gap-1" aria-label="Switch language">
        <Languages class="h-4 w-4" />
        <span class="text-xs font-medium">{{ currentLangAbbr }}</span>
        <span class="sr-only">Switch language</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem v-if="isLoading" disabled>
        Loading...
      </DropdownMenuItem>
      <template v-else>
        <DropdownMenuItem
          v-for="lang in languages"
          :key="lang.code"
          :class="{ 'font-semibold': currentLocaleCode === lang.code }"
          @click="setLocale(lang.code)"
        >
          {{ lang.name }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
