<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Palette, CopyCheck, Puzzle, LoaderCircle } from 'lucide-vue-next'
import { initializeTheme, currentTheme, applyThemeClass, generateTailwindStyles } from './themeManager'
import { useFont } from '@/composables/useFont'
import { useRouter } from 'vue-router'

const router = useRouter()

const formatRadius = (value: string) => value.replace('em', '')

const isOpen = ref(false)

const sheetContent = {
  header: {
    title: 'UI BuildY',
    btntitle: 'Go to BuildY',
    description: 'Manage application appearance and go to Tailwind Page Builder'
  },
  collections: {
    title: 'Welcome to UI BuildY',
    items: [
      {
        id: 'getBuildy',
        icon: Puzzle,
        label: 'Go to BuildY',
        action: () => router.push('/buildy'),
        class: 'bg-primary text-white'
      },
      {
        icon: LoaderCircle,
        label: 'Maintenance',
        action: () => router.push('#'),
        class: 'border-2 border-secondary-foreground/50'
      }
    ]
  },
  theme: {
    title: 'Theme Settings',
    sections: [
      {
        label: 'Color Scheme',
        type: 'colors',
        options: ['red', 'rose', 'orange', 'green', 'blue', 'violet']
      },
      {
        label: 'Corner Radius',
        type: 'radius',
        options: ['0', '0.3em', '0.5em', '0.75em', '1em']
      },
      {
        label: 'Font Family',
        type: 'font',
        options: [
          // sans-serif Playfair, 
          // sans
          'Nunito', 'Inter', 'Roboto', 'Lato', 'Lexend', 'Urbanist',
          'Kanit', 'Fira Sans', 'Karla', 'Prompt', 'Saira', 'Geologica', 'Bai Jamjuree', 'Niramit', 'Livvic', 'Exo', 'K2D', 'Jura', 'Philosopher', 'Montserrat', 'Open Sans', 'Rubik', 'Oswald','Work Sans', 'Mulish', 'Barlow', 'Heebo', 'Titillium Web', 'Libre Franklin', 'Josefin Sans', 'Jost', 'Outfit', 'Figtree', 'Overpass', 'Chivo', 'Alegreya Sans', 'Fahkwang'
        ]
      }
    ]
  }
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
      <Button variant="ghost" class="items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9">
        <Palette class="!w-[1.1rem] !h-[1.1rem]" />
      </Button>
    </SheetTrigger>
    <SheetContent class="w-full sm:w-[400px] max-w-[calc(100vw-32px)] border-secondary-foreground/20 p-0">
      <!-- Static header section -->
      <div class="p-6">
        <SheetHeader>
          <SheetTitle class="text-xl text-start">{{ sheetContent.header.title }}</SheetTitle>
          <SheetDescription class="flex items-center gap-4">
            <p class="text-sm text-left">
              {{ sheetContent.header.description }}
            </p>
          </SheetDescription>
        </SheetHeader>
      </div>
      
      <!-- BuildY Section -->
      <div class="px-6">
        <div class="grid grid-cols-2 gap-2">
            <Button 
              v-for="item in sheetContent.collections.items"
              :key="item.label"
              :id="item.id"
              variant="outline"
              :class="[
                'justify-start',
                item.class
              ]"
              @click="item.action"
            >
              <component :is="item.icon" class="mr-2 h-4 w-4" />
              <span>{{ item.label }}</span>
            </Button>
        </div>
      </div>

      <!-- Scrollable content -->
      <ScrollArea class="h-[calc(100%-120px)]"> <!-- Adjust height to account for header -->
        <div class="p-6">
          <div class="space-y-6">
            <!-- Theme Settings Section -->
            <div class="space-y-4">
              <h4 class="text-lg font-bold">{{ sheetContent.theme.title }}</h4>
              <div class="space-y-4">
                <template v-for="section in sheetContent.theme.sections" :key="section.label">
                  <div class="space-y-2">
                    <Label>{{ section.label }}</Label>
                    
                    <div v-if="section.type === 'colors'" class="grid grid-cols-2 gap-2">
                      <Button 
                        v-for="color in section.options"
                        :key="color"
                        variant="outline"
                        class="relative pl-8"
                        :class="{ 'border-2 border-primary': selectedColor === color }"
                        @click="selectedColor = color; updateTheme()"
                      >
                        <span 
                          class="absolute left-2 h-4 w-4 rounded-full"
                          :class="`bg-${color}-500`"
                        />
                        <span class="flex-1 text-center capitalize">{{ color }}</span>
                      </Button>
                    </div>

                    <div v-else-if="section.type === 'radius'" class="grid grid-cols-5 gap-2">
                      <Button
                        v-for="radius in section.options"
                        :key="radius"
                        variant="outline"
                        :class="{ 'border-2 border-primary': selectedRadius === radius }"
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
                      <SelectTrigger class="w-full">
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
      </ScrollArea>
    </SheetContent>
  </Sheet>
</template>