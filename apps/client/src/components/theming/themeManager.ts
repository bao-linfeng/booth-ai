import { ref } from 'vue'
import { themes } from './themes'
import { useFont } from '@/composables/useFont'

export const currentTheme = ref('')
const { loadFont, updateFontLink } = useFont()

export const generateTailwindStyles = (theme: string, radius: string) => {
  const themeConfig = themes.find(t => t.name === theme)
  if (!themeConfig) return ''
  
  const lightVars = Object.entries(themeConfig.cssVars.light)
    .map(([key, value]) => `    --${key}: ${value};`)
    .join('\n')
    
  const darkVars = Object.entries(themeConfig.cssVars.dark)
    .map(([key, value]) => `    --${key}: ${value};`)
    .join('\n')

  return `@layer base {
  :root {
${lightVars}
    --radius: ${radius};
  }

  .dark {
${darkVars}
  }
}`
}

export const initializeTheme = () => {
  const currentState = JSON.parse(localStorage.getItem('currentState') || '{}')
  const storedTheme = currentState?.sceleton?.theme || 'green'
  const storedRadius = currentState?.sceleton?.radius || '0.5rem'
  const storedFont = currentState?.sceleton?.config?.theme?.fontFamily?.sans?.[0] || 'Nunito'
  
  if (!currentState.sceleton) currentState.sceleton = {}
  
  // Загружаем базовую конфигурацию
  const defaultConfig = {
    darkMode: "class",
    theme: {
      fontFamily: {
        sans: [storedFont, "sans-serif"]
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

  currentState.sceleton.config = defaultConfig
  currentState.sceleton.theme = storedTheme
  currentState.sceleton.radius = storedRadius
  currentState.sceleton.tailwindStyles = generateTailwindStyles(storedTheme, storedRadius)
  
  currentTheme.value = storedTheme
  document.documentElement.style.setProperty('--radius', storedRadius)
  
  updateFontLink(storedFont)
  loadFont(storedFont)
  
  localStorage.setItem('currentState', JSON.stringify(currentState))
  applyThemeClass(storedTheme)
}

export const applyThemeClass = (theme: string) => {
  document.documentElement.classList.forEach(className => {
    if (className.startsWith('theme-')) {
      document.documentElement.classList.remove(className)
    }
  })
  document.documentElement.classList.add(`theme-${theme}`)
} 