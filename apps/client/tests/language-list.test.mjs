import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'location', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] })
}
// 真实的 api-client 与 ofetch，只替换登录态、路由与网络
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [{
    name: 'test-language-list', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (path === '@/router' || path.endsWith('/src/router') || path.endsWith('/src/router/index')) return '\0test-router'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/plugins/pinia/setup')) return '\0test-pinia'
      if (path === '@/plugins/i18n' || path.endsWith('/src/plugins/i18n')) return '\0test-i18n'
    },
    load(id) {
      if (id === '\0test-router') return 'export default globalThis.__languageList.router'
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__languageList.auth'
      if (id === '\0test-pinia') return 'export default {}'
      if (id === '\0test-i18n') return "export const appLocale = { value: 'zh' }"
    },
  }],
})
const originalFetch = globalThis.fetch
after(async () => {
  globalThis.fetch = originalFetch
  delete globalThis.__languageList
  await server.close()
  await window.happyDOM.close()
})

let requests
let auth
let pushes
beforeEach(() => {
  requests = []
  pushes = []
  auth = { token: 'local-session', clearAuth() { this.token = null } }
  globalThis.__languageList = {
    auth,
    router: { currentRoute: { value: { fullPath: '/schemes' } }, push: async to => { pushes.push(to) } },
  }
  // 与线上灵通接口一致：不带 token 返回 200，带本平台 token 返回 401
  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init)
    requests.push(request)
    if (request.headers.has('Authorization')) return new Response('{"code":401}', { status: 401, headers: { 'content-type': 'application/json' } })
    return Response.json({ code: 200, data: [{ code: 'en', name: 'English', description: '', orderIndex: 0 }] })
  }
})

const { getLanguageList } = await server.ssrLoadModule('/src/services/api/language.ts')

test('logged-in language list request sends no platform token and keeps the session', async () => {
  const response = await getLanguageList()
  assert.deepEqual(response.data.map(item => item.code), ['en'])
  assert.equal(requests.length, 1)
  assert.equal(new URL(requests[0].url).pathname, '/api/language/list')
  assert.equal(requests[0].headers.get('Authorization'), null)
  assert.equal(auth.token, 'local-session')
  assert.deepEqual(pushes, [])
})

test('an external 401 on the language list does not clear the platform session', async () => {
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init))
    return new Response('{"code":401}', { status: 401, headers: { 'content-type': 'application/json' } })
  }
  await assert.rejects(getLanguageList(), { status: 401 })
  assert.equal(auth.token, 'local-session')
  assert.deepEqual(pushes, [])
})
