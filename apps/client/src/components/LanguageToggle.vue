<script setup lang="ts">
import { computed } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Languages } from 'lucide-vue-next'
import { useAsyncState, useStorage } from '@vueuse/core'
import type { Language } from '@/plugins/i18n'
import { appLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/plugins/i18n'
import { loadAndSetLocale } from '@/plugins/i18n/setup'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getLanguageList, type LanguageItem } from '@/services/api/language'

const cachedLanguages = useStorage<LanguageItem[]>('app-language-list', [])

const fallbackLanguages: LanguageItem[] = [
  { code: 'zh', name: '简体中文', description: '', orderIndex: 0 },
  { code: 'en', name: 'English', description: '', orderIndex: 1 },
  { code: 'fr', name: 'Français', description: '', orderIndex: 2 },
  { code: 'de', name: 'Deutsch', description: '', orderIndex: 3 },
  { code: 'ja', name: '日本語', description: '', orderIndex: 4 },
  { code: 'ru', name: 'Русский', description: '', orderIndex: 5 },
  { code: 'it', name: 'Italiano', description: '', orderIndex: 6 },
  { code: 'es', name: 'Español', description: '', orderIndex: 7 },
  { code: 'ar', name: 'العربية', description: '', orderIndex: 8 },
  { code: 'hi', name: 'हिन्दी', description: '', orderIndex: 9 },
  { code: 'pt', name: 'Português', description: '', orderIndex: 10 },
  { code: 'ms', name: 'Bahasa Melayu', description: '', orderIndex: 11 },
]

const { state: languages, isLoading } = useAsyncState<LanguageItem[]>(
  cachedLanguages.value.length > 0
    ? Promise.resolve(cachedLanguages.value)
    : getLanguageList()
        .then(res => {
          cachedLanguages.value = res.data
          return res.data
        })
        .catch(() => fallbackLanguages),
  cachedLanguages.value.length > 0 ? cachedLanguages.value : fallbackLanguages
)

const currentLocaleCode = computed(() => (appLocale as Ref<string>).value)
const currentLangAbbr = computed(() => (currentLocaleCode.value || DEFAULT_LOCALE).slice(0, 2).toUpperCase())

function resolveLocale(code: string): Language {
  const short = code.split('-')[0] as Language
  return SUPPORTED_LOCALES.has(short) ? short : DEFAULT_LOCALE
}

const { t } = useI18n()
async function setLocale(lang: string) {
  const resolved = resolveLocale(lang)
  await loadAndSetLocale(resolved)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="gap-1 px-2 sm:px-3" :aria-label="t('common.switchLanguage')">
        <Languages class="h-4 w-4" />
        <span class="hidden text-xs font-medium sm:inline">{{ currentLangAbbr }}</span>
        <span class="sr-only">{{ t('common.switchLanguage') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem v-if="isLoading" disabled>
        {{ t('common.loading') }}
      </DropdownMenuItem>
      <template v-else>
        <DropdownMenuItem
          v-for="lang in languages"
          :key="lang.code"
          :class="{ 'font-semibold': currentLocaleCode === resolveLocale(lang.code) }"
          @click="setLocale(lang.code)"
        >
          {{ lang.name }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
