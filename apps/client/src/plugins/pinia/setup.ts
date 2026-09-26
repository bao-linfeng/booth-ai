import type { App } from 'vue'
import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'

const pinia = createPinia()

pinia.use(createPersistedState({
  storage: localStorage,
}))

export function setupPinia(app: App) {
  app.use(pinia)
}

export default pinia
