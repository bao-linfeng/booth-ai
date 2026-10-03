<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { ArrowRight, FolderOpen, History, Menu, MessageSquare, Sparkles } from 'lucide-vue-next'
import { Navbar, NavbarBrand } from '@/components/sections/navbar'
import { ThemingSettings } from '@/components/theming'
import LanguageToggle from '@/components/LanguageToggle.vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import UserAvatar from './UserAvatar.vue'

const route = useRoute()
const mobileMenuOpen = ref(false)
const isDesktop = useMediaQuery('(min-width: 1024px)')

const navigationItems = [
  {
    label: 'AI 智选',
    to: '/ai-selection',
    icon: Sparkles,
    description: '描述需求，找到适合您的展台方案',
    paths: ['/', '/ai-selection', '/schemes', '/theme-jobs', '/artwork-jobs'],
  },
  {
    label: '检索记录',
    to: '/my-searches',
    icon: History,
    description: '回看匹配方案与生成成果',
    paths: ['/my-searches'],
  },
  {
    label: '我的项目',
    to: '/my-projects',
    icon: FolderOpen,
    description: '查看申请记录与项目进展',
    paths: ['/my-projects'],
  },
]

function isActive(paths: string[]) {
  return paths.some(path => route.path === path || route.path.startsWith(`${path}/`))
}

watch(() => route.fullPath, () => { mobileMenuOpen.value = false })
watch(isDesktop, (value) => { if (value) mobileMenuOpen.value = false })
</script>

<template>
  <Navbar size="lg" class="border-border/80 bg-background/95">
    <div class="flex w-full min-w-0 items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-8 xl:gap-12">
        <NavbarBrand class="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="灵通 AI 展台首页">
          <img src="/logo.png" alt="灵通" class="h-7 w-auto max-w-20 object-contain sm:h-8 sm:max-w-24" />
          <span class="hidden border-l border-border pl-3 text-sm font-semibold tracking-wide sm:block">AI 展台</span>
        </NavbarBrand>

        <nav aria-label="主导航" class="hidden h-16 items-center gap-6 lg:flex xl:gap-8">
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

      <div class="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="sm" as-child class="hidden lg:inline-flex">
          <RouterLink
            to="/manual-request"
            :aria-current="route.path === '/manual-request' ? 'page' : undefined"
            :class="cn(route.path === '/manual-request' && 'bg-accent text-accent-foreground')"
          >
            <MessageSquare class="mr-2 size-4" aria-hidden="true" />
            联系顾问
          </RouterLink>
        </Button>
        <span class="mx-1 hidden h-5 w-px bg-border lg:block" aria-hidden="true" />
        <LanguageToggle />
        <ThemingSettings />
        <UserAvatar />

        <Sheet v-model:open="mobileMenuOpen">
          <SheetTrigger as-child>
            <Button variant="ghost" size="icon" class="lg:hidden" aria-label="打开导航菜单">
              <Menu class="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" class="flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-0 overflow-y-auto p-0">
            <SheetHeader class="border-b px-6 pb-6 pt-8 text-left">
              <SheetTitle>灵通 AI 展台</SheetTitle>
              <SheetDescription>从方案选型到项目落地</SheetDescription>
            </SheetHeader>
            <nav aria-label="移动端主导航" class="space-y-2 p-4">
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
                  <div class="text-sm font-semibold">联系顾问</div>
                  <p class="text-xs text-muted-foreground">提交特殊需求，获取人工协助</p>
                </div>
                <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
              </RouterLink>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  </Navbar>
</template>
