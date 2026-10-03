<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Settings2 } from 'lucide-vue-next'
import { DarkMode } from '@/components/darkMode'
import { cn } from '@/lib/utils'
import { initializeTheme, currentTheme, applyThemeClass, generateTailwindStyles } from './themeManager'
import { useFont } from '@/composables/useFont'

const formatRadius = (value: string) => value.replace('em', '')

const isOpen = ref(false)

const sheetContent = {
  header: {
    title: '外观设置',
    description: '调整此设备上的显示偏好'
  },
  theme: {
    title: '个性化外观',
    sections: [
      {
        label: '主题配色',
        type: 'colors',
        options: ['red', 'rose', 'orange', 'green', 'blue', 'violet']
      },
      {
        label: '圆角大小',
        type: 'radius',
        options: ['0', '0.3em', '0.5em', '0.75em', '1em']
      },
      {
        label: '字体',
        type: 'font',
        options: [
          'Nunito', 'Inter', 'Roboto', 'Lato', 'Lexend', 'Urbanist',
          'Kanit', 'Fira Sans', 'Karla', 'Prompt', 'Saira', 'Geologica', 'Bai Jamjuree', 'Niramit', 'Livvic', 'Exo', 'K2D', 'Jura', 'Philosopher', 'Montserrat', 'Open Sans', 'Rubik', 'Oswald','Work Sans', 'Mulish', 'Barlow', 'Heebo', 'Titillium Web', 'Libre Franklin', 'Josefin Sans', 'Jost', 'Outfit', 'Figtree', 'Overpass', 'Chivo', 'Alegreya Sans', 'Fahkwang'
        ]
      }
    ]
  }
}

const colorLabels: Record<string, string> = {
  red: '红色', rose: '玫瑰', orange: '橙色', green: '绿色', blue: '蓝色', violet: '紫色',
}

const selectedFont = ref(
  JSON.parse(localStorage.getItem('currentState') || '{}')?.sceleton?.config?.theme?.fontFamily?.sans?.[0] || 'Nunito'
)
const selectedColor = ref(currentTheme.value || 'green')
const selectedRadius = ref(JSON.parse(localStorage.getItem('currentState') || '{}')?.sceleton?.radius || '0.5rem')

const { loadFont, updateFontLink } = useFont()

const updateTheme = async () => {
  const currentState = JSON.parse(localStorage.getItem('currentState') || '{}')
  
  if (!currentState.sceleton) currentState.sceleton = {}
  if (!currentState.sceleton.config) currentState.sceleton.config = {}
  
  // Загружаем базовую конфигурацию
  const defaultConfig = {
    darkMode: "class",
    theme: {
      fontFamily: {
        sans: [selectedFont.value, "sans-serif"]
      },
      container: {
        center: true,
        padding: "2rem"
      },
      extend: {
        colors: {
          border: "hsl(var(--border))",
          input: "hsl(var(--input))",
          ring: "hsl(var(--ring))",
          background: "hsl(var(--background))",
          foreground: "hsl(var(--foreground))",
          primary: {
            DEFAULT: "hsl(var(--primary))",
            foreground: "hsl(var(--primary-foreground))"
          },
          secondary: {
            DEFAULT: "hsl(var(--secondary))",
            foreground: "hsl(var(--secondary-foreground))"
          },
          destructive: {
            DEFAULT: "hsl(var(--destructive))",
            foreground: "hsl(var(--destructive-foreground))"
          },
          muted: {
            DEFAULT: "hsl(var(--muted))",
            foreground: "hsl(var(--muted-foreground))"
          },
          accent: {
            DEFAULT: "hsl(var(--accent))",
            foreground: "hsl(var(--accent-foreground))"
          },
          popover: {
            DEFAULT: "hsl(var(--popover))",
            foreground: "hsl(var(--popover-foreground))"
          },
          card: {
            DEFAULT: "hsl(var(--card))",
            foreground: "hsl(var(--card-foreground))"
          }
        },
        borderRadius: {
          xl: "calc(var(--radius) + 4px)",
          lg: "var(--radius)",
          md: "calc(var(--radius) - 2px)",
          sm: "calc(var(--radius) - 4px)"
        }
      }
    }
  }

  // Обновляем только шрифт в конфигурации
  currentState.sceleton.config = defaultConfig
  currentState.sceleton.config.theme.fontFamily.sans = [selectedFont.value, "sans-serif"]
  
  currentTheme.value = selectedColor.value
  currentState.sceleton.theme = selectedColor.value
  currentState.sceleton.radius = selectedRadius.value
  currentState.sceleton.tailwindStyles = generateTailwindStyles(selectedColor.value, selectedRadius.value)
  
  updateFontLink(selectedFont.value)
  await loadFont(selectedFont.value)
  
  document.documentElement.style.setProperty('--radius', selectedRadius.value)
  
  const serializedState = JSON.stringify(currentState, null, 2)
  localStorage.setItem('currentState', serializedState)
  
  applyThemeClass(selectedColor.value)
}

onMounted(() => {
  initializeTheme()
  if (currentTheme.value && currentTheme.value !== selectedColor.value) {
    selectedColor.value = currentTheme.value
    updateTheme()
  }
})
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetTrigger as-child>
      <Button variant="ghost" size="icon" aria-label="外观设置" title="外观设置">
        <Settings2 class="size-4" aria-hidden="true" />
      </Button>
    </SheetTrigger>
    <SheetContent class="flex w-full max-w-[calc(100vw-32px)] flex-col gap-0 p-0 sm:w-[400px]">
      <SheetHeader class="shrink-0 border-b p-6 text-left">
        <SheetTitle>{{ sheetContent.header.title }}</SheetTitle>
        <SheetDescription>{{ sheetContent.header.description }}</SheetDescription>
      </SheetHeader>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="p-6">
          <div class="space-y-6">
            <div class="flex items-center justify-between gap-4 border-b pb-6">
              <div class="space-y-1">
                <h3 class="text-sm font-medium">明暗模式</h3>
                <p class="text-xs text-muted-foreground">切换浅色或深色显示</p>
              </div>
              <DarkMode />
            </div>
            <div class="space-y-4">
              <h4 class="text-lg font-bold">{{ sheetContent.theme.title }}</h4>
              <div class="space-y-4">
                <template v-for="section in sheetContent.theme.sections" :key="section.label">
                  <div class="space-y-2">
                    <Label :id="`appearance-${section.type}`">{{ section.label }}</Label>
                    
                    <div v-if="section.type === 'colors'" role="group" :aria-labelledby="`appearance-${section.type}`" class="grid grid-cols-2 gap-2">
                      <Button 
                        v-for="color in section.options"
                        :key="color"
                        variant="outline"
                        :aria-pressed="selectedColor === color"
                        :class="cn('relative pl-8', selectedColor === color && 'border-2 border-primary')"
                        @click="selectedColor = color; updateTheme()"
                      >
                        <span 
                          class="absolute left-2 h-4 w-4 rounded-full"
                          :class="`bg-${color}-500`"
                        />
                        <span class="flex-1 text-center">{{ colorLabels[color] }}</span>
                      </Button>
                    </div>

                    <div v-else-if="section.type === 'radius'" role="group" :aria-labelledby="`appearance-${section.type}`" class="grid grid-cols-5 gap-2">
                      <Button
                        v-for="radius in section.options"
                        :key="radius"
                        variant="outline"
                        :aria-pressed="selectedRadius === radius"
                        :class="cn('px-1', selectedRadius === radius && 'border-2 border-primary')"
                        @click="selectedRadius = radius; updateTheme()"
                      >
                        {{ formatRadius(radius) }}
                      </Button>
                    </div>

                    <Select 
                      v-else-if="section.type === 'font'"
                      v-model="selectedFont"
                      @update:modelValue="updateTheme"
                    >
                      <SelectTrigger class="w-full" :aria-labelledby="`appearance-${section.type}`">
                        <SelectValue :placeholder="selectedFont" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem 
                          v-for="font in section.options"
                          :key="font"
                          :value="font"
                        >
                          <span :style="{ fontFamily: font }">{{ font }}</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
