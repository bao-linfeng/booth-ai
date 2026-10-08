<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { ArrowRight, FolderOpen, Headset, History, Menu, MessageSquare, Sparkles } from 'lucide-vue-next'
import { useCustomerService } from '@/features/customer-service/useCustomerService'
import { Navbar, NavbarBrand } from '@/components/navbar'
import { ThemingSettings } from '@/components/theming'
import LanguageToggle from '@/components/LanguageToggle.vue'
import { appLocale } from '@/plugins/i18n'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import UserAvatar from './UserAvatar.vue'

const route = useRoute()
const { t } = useI18n()
const { state: customerService, openWith: openCustomerService } = useCustomerService()
const mobileMenuOpen = ref(false)
const isDesktop = useMediaQuery('(min-width: 1024px)')

const navigationItems = computed(() => [
  {
    label: t('nav.aiSelection'),
    to: '/ai-selection',
    icon: Sparkles,
    description: t('nav.aiSelectionDesc'),
    paths: ['/', '/ai-selection', '/schemes', '/theme-jobs', '/artwork-jobs'],
  },
  {
    label: t('nav.mySearches'),
    to: '/my-searches',
    icon: History,
    description: t('nav.mySearchesDesc'),
    paths: ['/my-searches'],
  },
  {
    label: t('nav.myProjects'),
    to: '/my-projects',
    icon: FolderOpen,
    description: t('nav.myProjectsDesc'),
    paths: ['/my-projects'],
  },
])

function isActive(paths: string[]) {
  return paths.some(path => route.path === path || route.path.startsWith(`${path}/`))
}

watch(() => route.fullPath, () => { mobileMenuOpen.value = false })
watch(isDesktop, (value) => { if (value) mobileMenuOpen.value = false })
</script>

<template>
  <Navbar size="lg" class="relative top-auto h-auto min-h-16 border-border/70 bg-card/80 py-2 supports-[backdrop-filter]:bg-card/70 lg:sticky lg:top-0 lg:py-0">
    <div class="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-8 xl:gap-12">
        <NavbarBrand class="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-label="t('controls.brandHome')">
          <img src="/logo.png" :alt="t('controls.brandLogo')" class="h-7 w-auto max-w-20 object-contain sm:h-8 sm:max-w-24" />
          <span class="hidden border-s border-border ps-3 text-sm font-semibold tracking-wide sm:block">{{ t('controls.brandName') }}</span>
        </NavbarBrand>

        <nav :aria-label="t('nav.mainNav')" class="hidden h-16 items-center gap-6 lg:flex xl:gap-8">
          <RouterLink
            v-for="item in navigationItems"
            :key="item.to"
            :to="item.to"
            :aria-current="isActive(item.paths) ? 'page' : undefined"
            :class="cn(
              'inline-flex h-full items-center whitespace-nowrap border-b-2 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              isActive(item.paths) ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>

      <div class="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 sm:gap-2">
        <Button variant="ghost" size="sm" as-child class="hidden lg:inline-flex">
          <RouterLink
            to="/manual-request"
            :aria-current="route.path === '/manual-request' ? 'page' : undefined"
            :class="cn(route.path === '/manual-request' && 'bg-accent text-accent-foreground')"
          >
            <MessageSquare class="me-2 size-4" aria-hidden="true" />
            {{ t('nav.contactAdvisor') }}
          </RouterLink>
        </Button>
        <Button variant="ghost" size="sm" class="relative hidden lg:inline-flex" data-cs-nav @click="openCustomerService(undefined, 'floating')">
          <Headset class="me-2 size-4" aria-hidden="true" />
          {{ t('customerService.launcher') }}
          <span
            v-if="customerService.unreadCount && !customerService.open"
            class="ms-1 min-w-5 rounded-full bg-destructive px-1.5 text-xs leading-5 text-destructive-foreground"
            :aria-label="t('customerService.unread', { count: customerService.unreadCount })"
          >{{ customerService.unreadCount > 99 ? '99+' : customerService.unreadCount }}</span>
        </Button>
        <span class="mx-1 hidden h-5 w-px bg-border lg:block" aria-hidden="true" />
        <LanguageToggle />
        <ThemingSettings />
        <UserAvatar />

        <Sheet v-model:open="mobileMenuOpen">
          <SheetTrigger as-child>
            <Button variant="ghost" size="icon" class="lg:hidden" :aria-label="t('nav.openMenu')">
              <Menu class="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent :side="appLocale === 'ar' ? 'right' : 'left'" class="flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-0 overflow-y-auto p-0">
            <SheetHeader class="border-b px-6 pb-6 pt-8 text-start sm:text-start">
              <SheetTitle>{{ t('nav.brand') }}</SheetTitle>
              <SheetDescription>{{ t('nav.brandSlogan') }}</SheetDescription>
            </SheetHeader>
            <nav :aria-label="t('nav.mobileNav')" class="space-y-2 p-4">
              <RouterLink
                v-for="item in navigationItems"
                :key="item.to"
                :to="item.to"
                :aria-current="isActive(item.paths) ? 'page' : undefined"
                :class="cn(
                  'flex items-center gap-3 rounded-lg p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive(item.paths) ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                )"
                @click="mobileMenuOpen = false"
              >
                <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                <div class="min-w-0 space-y-1">
                  <div class="text-sm font-semibold">{{ item.label }}</div>
                  <p class="text-xs leading-relaxed text-muted-foreground">{{ item.description }}</p>
                </div>
              </RouterLink>
            </nav>
            <div class="mx-4 mb-6 mt-auto border-t pt-4">
              <RouterLink
                to="/manual-request"
                :aria-current="route.path === '/manual-request' ? 'page' : undefined"
                :class="cn('flex items-center gap-3 rounded-lg p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', route.path === '/manual-request' && 'bg-primary/10 text-primary')"
                @click="mobileMenuOpen = false"
              >
                <MessageSquare class="size-5 shrink-0" aria-hidden="true" />
                <div class="flex-1 space-y-1">
                  <div class="text-sm font-semibold">{{ t('nav.contactAdvisor') }}</div>
                  <p class="text-xs text-muted-foreground">{{ t('nav.contactAdvisorDesc') }}</p>
                </div>
                <ArrowRight class="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </RouterLink>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  </Navbar>
</template>
