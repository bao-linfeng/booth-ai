import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'location']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] })
}
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [{
    name: 'test-external-login', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-router') return '\0test-router'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/plugins/pinia/setup')) return '\0test-pinia'
    },
    load(id) {
      if (id === '\0test-router') return "export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-api') return 'export const apiFetch = (...args) => globalThis.__externalLogin.apiFetch(...args); export const getVisitorId = () => "visitor_test_123456789"'
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__externalLogin.auth'
      if (id === '\0test-pinia') return 'export default {}'
    },
  }],
})
after(async () => { delete globalThis.__externalLogin; await server.close(); await window.happyDOM.close() })
const { createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-router')
const { externalLoginGuard } = await server.ssrLoadModule('/src/router/external-login.ts')
const { login, syncAuth } = await server.ssrLoadModule('/src/services/api/auth.ts')
let calls
let auth
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  calls = []
  auth = {
    token: 'previous-session', currentUser: { type: 'client' },
    clearAuth() { this.token = null; this.currentUser = null },
    setLoginResult(token, user) { this.token = token; this.currentUser = user },
  }
  globalThis.__externalLogin = {
    auth,
    apiFetch: async (path, options) => {
      calls.push({ path, ...options, urlDuringRequest: window.location.href })
      return { code: 0, data: { accessToken: 'local-session', user: { type: options.body.type } } }
    },
  }
})

async function navigate(url) {
  const component = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component }, { path: '/auth/sign-in', component }, { path: '/profile', component }] })
  router.beforeEach(externalLoginGuard)
  window.history.replaceState(null, '', url)
  await router.push(url)
  return router.currentRoute.value
}

test('homepage SU token passes the type through the real auth service and cleans login parameters', async () => {
  const route = await navigate('/?token=external-token&username=demo&type=su&campaign=expo#selection')
  assert.equal(route.fullPath, '/?campaign=expo#selection')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/api/v1/client/auth/sync')
  assert.deepEqual(calls[0].body, { token: 'external-token', username: 'demo', type: 'su' })
  assert.equal(calls[0].urlDuringRequest, 'http://localhost/?campaign=expo#selection')
  assert.equal(auth.token, 'local-session')
  assert.equal(auth.currentUser.type, 'su')
})

test('homepage token without a type defaults to client', async () => {
  const route = await navigate('/?token=external-token&username=demo')
  assert.equal(route.fullPath, '/')
  assert.equal(calls[0].body.type, 'client')
  assert.equal(auth.currentUser.type, 'client')
})

test('password login explicitly sends client and direct sync defaults to client', async () => {
  await login({ username: 'demo', password: 'test-password' })
  assert.equal(calls[0].path, '/api/v1/client/auth/login')
  assert.deepEqual(calls[0].body, { username: 'demo', password: 'test-password', type: 'client' })
  await syncAuth({ username: 'demo', token: 'external-token' })
  assert.equal(calls[1].body.type, 'client')
})

test('invalid or repeated types and missing credentials return to sign-in without synchronizing', async () => {
  for (const query of ['token=external-token&username=demo&type=admin', 'token=external-token&username=demo&type=su&type=client', 'token=external-token&type=su']) {
    const route = await navigate(`/?${query}&campaign=expo`)
    assert.equal(route.path, '/auth/sign-in')
    assert.equal(route.query.redirect, '/?campaign=expo')
    assert.equal(auth.token, null)
  }
  assert.equal(calls.length, 0)
})

test('failed synchronization cleans the type and credentials before redirecting to sign-in', async () => {
  globalThis.__externalLogin.apiFetch = async () => { throw new Error('Unauthorized') }
  const route = await navigate('/?token=external-token&username=demo&type=su&campaign=expo')
  assert.equal(route.path, '/auth/sign-in')
  assert.equal(route.query.redirect, '/?campaign=expo')
  assert.equal(window.location.href, 'http://localhost/?campaign=expo')
  assert.equal(auth.token, null)
})

test('ordinary homepage and other pages do not trigger external login', async () => {
  assert.equal((await navigate('/?type=su')).fullPath, '/?type=su')
  assert.equal((await navigate('/profile?token=external-token&username=demo&type=su')).path, '/profile')
  assert.equal(calls.length, 0)
  assert.equal(auth.token, 'previous-session')
})
