import { createApp } from 'vue'
import '@/assets/index.css'
import App from './App.vue'
import router from './router'
import { initializeTheme } from '@/components/theming/themeManager'
import './components/theming/themes.css'
import { setupI18n } from '@/plugins/i18n/setup'
import { setupPinia } from '@/plugins/pinia/setup'

initializeTheme()

const app = createApp(App)
setupPinia(app)
setupI18n(app)
app.use(router)
app.mount('#app')
