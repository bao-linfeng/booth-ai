<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { Navbar, NavbarBrand, NavbarLayer } from '@/components/sections/navbar'
import { DarkMode } from '@/components/darkMode'
import { ThemingSettings } from '@/components/theming'
import { Home, ChevronsRight, AlignRight, Combine } from 'lucide-vue-next'
import LanguageToggle from '@/components/LanguageToggle.vue'
import UserAvatar from './UserAvatar.vue'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { defineAsyncComponent, ref, watch, onMounted } from 'vue'
import { useCollecty } from '@/composables/useCollecty'

const router = useRouter()
// const route = useRoute()

const { collection } = useCollecty()
const isButtonVisible = ref(false)

// Следим за изменениями в коллекции
watch(() => collection.value, (newCollection) => {
  isButtonVisible.value = newCollection.length > 0
}, { immediate: true, deep: true })

interface RouteChild {
  name: string
  path: string
  title: string
  description?: string
  meta: {
    icon?: string
    title: string
    description?: string
  }
}

interface ParentRoute {
  name: string
  path: string
  title: string
  description?: string
  children?: RouteChild[]
}

// Расширяем структуру маршрутов с правильной типизацией
const parentRoutes = router.getRoutes()
  .filter(route => route.meta?.isGroupParent)
  .map(route => ({
    name: String(route.name),
    path: route.path,
    title: route.meta?.title as string,
    description: route.meta?.description as string,
    children: route.children?.map(child => ({
      name: String(child.name),
      path: child.path,
      title: child.meta?.title as string,
      description: child.meta?.description as string,
      meta: {
        icon: child.meta?.icon as string,
        title: child.meta?.title as string,
        description: child.meta?.description as string
      }
    }))
  })) as ParentRoute[]

// Динамический импорт иконок из роутера
const getIcon = (iconName?: string) => {
  if (!iconName) return ChevronsRight
  
  return defineAsyncComponent({
    loader: () => import('lucide-vue-next').then((mod: any) => mod[iconName]),
    errorComponent: ChevronsRight
  })
}

// Обновляем идентификаторы для доступности
const sheetId = 'mobile-navigation'
const menuDescription = 'Main navigation menu with all available sections and pages'
</script>

<template>
  <Navbar class="border-b-[0.5px] border-gradient shadow-glow h-[64px]" style="--navbar-height: 64px;">
    <div class="flex container mx-auto px-2 md:px-4 lg:px-8">
      <NavbarLayer position="start" class="flex-1">
        <div class="flex items-center gap-6">
          <NavbarBrand>
            <img src="/logo.png" alt="Logo" class="h-8 w-auto object-contain" />
          </NavbarBrand>
          
          <!-- Обновляем десктопную навигацию -->
          <NavigationMenu class="hidden md:flex">
            <NavigationMenuList>
              <NavigationMenuItem v-for="parentRoute in parentRoutes" :key="parentRoute.path">
                <NavigationMenuTrigger>{{ parentRoute.title }}</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul class="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                    <li v-for="child in parentRoute.children" :key="child.path">
                      <NavigationMenuLink as-child>
                        <router-link
                          :to="`${parentRoute.path}/${child.path}`"
                          class="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                        >
                          <div class="text-sm font-medium leading-none">{{ child.title }}</div>
                          <p v-if="child.description" class="line-clamp-2 text-sm leading-snug text-muted-foreground">
                            {{ child.description }}
                          </p>
                        </router-link>
                      </NavigationMenuLink>
                    </li>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
      </NavbarLayer>

      <!-- Правая часть: кнопки -->
      <NavbarLayer position="end" data-navbar-end>
        <div class="flex items-center gap-1 md:gap-2">
          
          <Button 
            v-if="isButtonVisible"
            variant="default"
            size="sm"
            class="bg-primary text-white mr-2"
            aria-label="Go to builder"
            @click="router.push('/buildy')"
          >
            <Combine :stroke-width="2.5" class="!w-3.5 !h-3.5" />
            <span class="font-base">BuildY</span>
          </Button>
          
          <LanguageToggle />
          <DarkMode data-dark-mode />
          <ThemingSettings />
          <UserAvatar />

        <!-- Мобильное меню -->
        <Sheet>
          <SheetTrigger as-child>
            <Button 
              variant="ghost" 
              size="icon" 
              class="md:hidden"
              :aria-controls="sheetId"
              aria-label="Open navigation menu"
            >
            <AlignRight class="!w-[1.5rem] !h-[1.5rem]" />
              <span class="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
            
            <SheetContent 
              class="w-[300px] p-0 sheet-content border-r border-secondary-foreground/20 shadow-glow "
              side="left"
            >
              <SheetHeader class="p-4 sheet-header border-b-[0.3px] border-gradient shadow-glow">
                <SheetTitle class="flex items-center gap-2 text-base mb-2">
                  <NavbarBrand>
                    <img src="/logo.png" alt="Logo" class="h-7 w-auto object-contain" />
                  </NavbarBrand>
                </SheetTitle>
                <SheetDescription class="text-sm text-muted-foreground">
                  {{ menuDescription }}
                </SheetDescription>
              </SheetHeader>
              
              <ScrollArea class="h-[calc(100vh-80px)]">
                <div class="p-4">
                  <router-link 
                    to="/" 
                    class="flex items-center gap-2 px-2 py-1.5 text-sm font-medium rounded-md hover:bg-accent hover:text-accent-foreground"
                    aria-label="Go to home page"
                  >
                    <Home class="h-4 w-4" />
                    <span>Home</span>
                  </router-link>
                  
                  <Separator class="my-4" />
                  
                  <Accordion 
                    type="single" 
                    collapsible
                    class="w-full"
                  >
                    <AccordionItem 
                      v-for="route in parentRoutes" 
                      :key="route.path" 
                      :value="route.path"
                    >
                      <AccordionTrigger 
                        class="text-sm no-underline"
                        :aria-label="`Toggle ${route.title} section`"
                      >
                        {{ route.title }}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div class="pl-1 py-2 space-y-1">
                          <router-link
                            v-for="child in route.children"
                            :key="child.path"
                            :to="`${route.path}/${child.path}`"
                            class="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
                            :class="[
                              route.path === $route.path ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                            ]"
                            :aria-label="`Go to ${child.title}`"
                            :aria-current="route.path === $route.path ? 'page' : undefined"
                          >
                            <component 
                              :is="getIcon(child.meta?.icon)" 
                              class="h-4 w-4" 
                              aria-hidden="true"
                            />
                            <div>
                              <div>{{ child.title }}</div>
                              <p 
                                v-if="child.description" 
                                class="text-xs text-muted-foreground line-clamp-1"
                              >
                                {{ child.description }}
                              </p>
                            </div>
                          </router-link>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </NavbarLayer>
    </div>
  </Navbar>
</template>

<style scoped>
/* Активная ссылка */
.router-link-active {
  color: hsl(var(--primary));
}

/* Градиентная граница */
.border-gradient {
  border-image: linear-gradient(
    to right,
    hsl(var(--primary) / 0.1),
    hsl(var(--primary) / 0.4),
    hsl(var(--primary) / 0.1)
  ) 1;
}

:global(.dark) .border-gradient {
  border-image: linear-gradient(
    to right,
    hsl(var(--primary) / 0.2),
    hsl(var(--primary) / 0.5),
    hsl(var(--primary) / 0.2)
  ) 1;
}

/* Тень с подсветкой */
.shadow-glow {
  box-shadow: 
    0 1px 2px -1px hsl(var(--primary) / 0.1),
    0 0 0 1px hsl(var(--primary) / 0.05),
    0 1px 2px 0 hsl(var(--primary) / 0.05);
}

:global(.dark) .shadow-glow {
  box-shadow: 
    0 1px 2px -1px hsl(var(--primary) / 0.2),
    0 0 0 1px hsl(var(--primary) / 0.1),
    0 1px 2px 0 hsl(var(--primary) / 0.1);
}

/* Эффект при наведении */
.shadow-glow:hover {
  box-shadow: 
    0 2px 4px -2px hsl(var(--primary) / 0.15),
    0 0 0 1px hsl(var(--primary) / 0.1),
    0 1px 3px 0 hsl(var(--primary) / 0.1);
  transition: all 0.3s ease;
}

:global(.dark) .shadow-glow:hover {
  box-shadow: 
    0 2px 4px -2px hsl(var(--primary) / 0.25),
    0 0 0 1px hsl(var(--primary) / 0.15),
    0 1px 3px 0 hsl(var(--primary) / 0.15);
}

/* Разделители аккордеона */
:deep([data-orientation="vertical"].border-b) {
  border-bottom-color: hsl(var(--border) / 0.9) !important;
}
</style> 