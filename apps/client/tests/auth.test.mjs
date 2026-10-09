import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'location', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] })
}
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)), 'vue-i18n': fileURLToPath(new URL('./mock-i18n.ts', import.meta.url)) } },
  plugins: [{
    name: 'test-auth', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-deps') return '\0test-deps'
      if (path.endsWith('/services/api/auth')) return '\0test-auth-api'
      if (path.endsWith('/services/api/user')) return '\0test-user-api'
      if (path.endsWith('/features/customer-service/useCustomerService')) return '\0test-cs'
      if (path.endsWith('/stores/auth') && globalThis.__auth.mockStore) return '\0test-store'
    },
    load(id) {
      if (id === '\0test-deps') return "export { createApp } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'; export { createPinia, setActivePinia } from 'pinia'"
      if (id === '\0test-auth-api') return 'export const login = async () => {}; export const logout = (...args) => globalThis.__auth.logout(...args)'
      if (id === '\0test-user-api') return 'export const fetchCurrentUser = async () => ({})'
      if (id === '\0test-cs') return 'export const resetCustomerService = () => { globalThis.__auth.state.resets++ }; export const handleCustomerServiceLogin = () => {}'
      if (id === '\0test-store') return 'export const useAuthStore = () => globalThis.__auth.store'
    },
  }],
})
after(async () => { delete globalThis.__auth; await server.close(); await window.happyDOM.close() })
const { createApp, createRouter, createMemoryHistory, createPinia, setActivePinia } = await server.ssrLoadModule('virtual:test-deps')

let state
beforeEach(() => {
  state = { logouts: 0, clears: 0, pushes: [], resets: 0 }
  globalThis.__auth = {
    mockStore: true,
    state,
    logout: async () => { state.logouts++; await new Promise(resolve => setTimeout(resolve, 10)) },
    store: { token: 'token', clearAuth: () => { state.clears++ } },
  }
})

// useAuth 依赖 useRoute/useRouter：在挂了真实路由的 app 上下文中调用，并记录跳转目标
async function useAuthInApp() {
  const { useAuth } = await server.ssrLoadModule('/src/composables/useAuth.ts')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/')
  const push = router.push.bind(router)
  router.push = async to => { state.pushes.push(to); return push(to) }
  const app = createApp({ render: () => null })
  app.use(router)
  return app.runWithContext(() => useAuth())
}

test('logout revokes the server session, clears identity and navigates exactly once even when triggered twice', async () => {
  const { logout } = await useAuthInApp()
  await Promise.all([logout(), logout()])
  assert.deepEqual(state, { logouts: 1, clears: 1, pushes: ['/auth/sign-in'], resets: 0 })
  await logout()
  assert.equal(state.logouts, 2, 'a later logout is allowed once the previous one finished')
})

test('logout still clears the local identity once when the server call fails', async () => {
  globalThis.__auth.logout = async () => { state.logouts++; throw new Error('offline') }
  await (await useAuthInApp()).logout()
  assert.deepEqual(state, { logouts: 1, clears: 1, pushes: ['/auth/sign-in'], resets: 0 })
})

test('clearing identity rotates the visitor ID only when a login was active', async () => {
  globalThis.__auth.mockStore = false
  setActivePinia(createPinia())
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/auth.ts')
  const { getVisitorId } = await server.ssrLoadModule('/src/lib/visitor-id.ts')
  const store = useAuthStore()
  const anonymous = getVisitorId()
  store.clearAuth()
  assert.equal(getVisitorId(), anonymous, 'an anonymous visitor keeps its ID so searches can be linked at login')
  store.token = 'token'
  store.clearAuth()
  // 清空客服会话是动态导入后执行的，首次加载需要时间
  for (let i = 0; i < 100 && state.resets === 0; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.notEqual(getVisitorId(), anonymous)
  assert.equal(store.token, null)
  assert.equal(state.resets, 1)
})
