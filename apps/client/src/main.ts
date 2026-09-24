import { createApp } from 'vue'
import '@/assets/index.css'
import App from './App.vue'
import router from './router'
import { initializeTheme } from '@/components/theming/themeManager'
import './components/theming/themes.css'
import { useCollecty } from '@/composables/useCollecty'

// Initialize theme and collecty store
initializeTheme()
useCollecty()

const app = createApp(App)
app.use(router)
app.mount('#app')