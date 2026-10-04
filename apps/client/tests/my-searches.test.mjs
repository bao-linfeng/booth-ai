import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
registerTS(() => ts)
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [{
    name: 'test-my-searches', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/features/selection/SelectionShell.vue')) return '\0test-shell'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__mySearches.apiFetch(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__mySearches.auth'
    },
    async transform(source, id) {
      if (!id.endsWith('.vue')) return
      const { descriptor } = parse(source, { filename: id })
      const script = compileScript(descriptor, { id, inlineTemplate: true, fs: {
        fileExists: path => { try { return statSync(path).isFile() } catch { return false } }, readFile: path => readFileSync(path, 'utf8'),
      } })
      return transformWithEsbuild(script.content, id + '.ts', { loader: 'ts' })
    },
  }],
})
after(async () => {
  delete globalThis.__mySearches
  await server.close()
  await window.happyDOM.close()
})
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: MySearches } = await server.ssrLoadModule('/src/pages/MySearches.vue')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await sleep(5) } }
const specifications = { lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18, openingCount: 2, productSystemId: 'p', productSystemLabel: '标准' }
const requirement = { lengthMm: 6000, widthMm: 3000, maxHeightMm: 4500, areaM2: 18, openingCount: 2 }
const themeJobId = '11111111-1111-1111-1111-111111111111'
const artworkJobId = '22222222-2222-2222-2222-222222222222'
function scheme(code, overrides = {}) {
  return { code, matchType: 'direct', specifications, thumbnail: `/${code}.jpg`, theme: null, artwork: null, ...overrides }
}
function record(overrides = {}) {
  return {
    id: 'search-1', status: 'matched', mode: 'filtered', inputText: '科技展台，需要大屏和洽谈区', finalRequirement: requirement,
    counts: { direct: 5, reference: 1, random: 0, total: 6 }, createdAt: '2026-10-01T08:00:00.000Z',
    items: [
      scheme('SC-1', {
        theme: { jobId: themeJobId, status: 'succeeded', createdAt: '2026-10-01T09:00:00.000Z', previewUrl: '/theme.jpg' },
        artwork: { jobId: artworkJobId, status: 'partially_succeeded', createdAt: '2026-10-01T10:00:00.000Z', deliveryStatus: 'incomplete', views: [{ direction: 'front', previewUrl: '/front.jpg' }, { direction: 'left', previewUrl: '/left.jpg' }] },
      }),
      scheme('SC-2', { theme: { jobId: 'theme-running', status: 'running', createdAt: '2026-10-01T09:30:00.000Z', previewUrl: null } }),
      scheme('SC-3'), scheme('SC-4'), scheme('SC-5', { matchType: 'reference' }), scheme('SC-6'),
    ],
    ...overrides,
  }
}
async function mount({ loggedIn = true, get = () => ({ items: [record()], total: 1, page: 1, pageSize: 20 }) } = {}) {
  const calls = []
  globalThis.__mySearches = {
    auth: { isLoggedIn: loggedIn },
    apiFetch: async (path, options) => {
      calls.push({ path, options })
      assert.ok(path.startsWith('/api/v1/client/me/searches?'), `Unexpected API: ${path}`)
      return { code: 0, data: structuredClone(await get(path)) }
    },
  }
  const router = createRouter({ history: createMemoryHistory(), routes: ['/my-searches', '/:pathMatch(.*)*'].map(path => ({ path, component: { render: () => null } })) })
  await router.push('/my-searches')
  await router.isReady()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(MySearches) })
  app.use(router)
  app.mount(container)
  await settle()
  return { container, router, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}
function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim().startsWith(text))
  assert.ok(found, `Button not found: ${text}`)
  return found
}
const hrefs = container => [...container.querySelectorAll('a')].map(link => link.getAttribute('href'))

test('collapsed record shows requirement summary, time, thumbnails and generation status without per-scheme blocks', async () => {
  const mounted = await mount()
  const text = mounted.container.textContent
  for (const expected of ['6 × 3 m', '18 ㎡', '2 面开口', '限高 4.5 m', '科技展台，需要大屏和洽谈区', '5 套直接采用 · 1 套参考', '另有 2 套', '换主题 2 套 · 四面素材 1 套 · 1 项生成中']) assert.ok(text.includes(expected), expected)
  const record = mounted.container.querySelector('[data-record="search-1"]')
  const recordText = record.textContent
  assert.equal(record.querySelectorAll('img').length, 4)
  assert.equal(record.querySelector('time').getAttribute('datetime'), '2026-10-01T08:00:00.000Z')
  for (const hidden of ['AI 换主题', '四面视图', '未换主题', '尚未生成', '本次检索尚未换主题']) assert.ok(!recordText.includes(hidden), hidden)
  assert.equal(record.querySelector('ul'), null)
  assert.equal(button(record, '查看 6 套方案的成果').getAttribute('aria-expanded'), 'false')
  assert.ok(hrefs(record).includes('/schemes/SC-1?searchId=search-1'))
  await mounted.close()
})

test('expanding reveals task links, compact empty states and only the existing four-direction views', async () => {
  const mounted = await mount()
  const toggle = button(mounted.container, '查看 6 套方案的成果')
  toggle.click()
  await settle()
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(toggle.textContent.trim(), '收起成果')
  assert.equal(toggle.getAttribute('aria-controls'), mounted.container.querySelector('ul').id)
  const rows = [...mounted.container.querySelectorAll('ul > li')]
  assert.equal(rows.length, 6)
  const links = hrefs(mounted.container)
  assert.ok(links.includes(`/theme-jobs/${themeJobId}`))
  assert.ok(links.includes(`/artwork-jobs/${artworkJobId}`))
  assert.ok(links.includes('/theme-jobs/theme-running'))
  const first = rows[0]
  assert.ok(first.textContent.includes('已完成') && first.textContent.includes('部分完成'))
  assert.deepEqual([...first.querySelectorAll('button[aria-label^="放大 SC-1 "]')].map(item => item.getAttribute('aria-label')), ['放大 SC-1 原始方案', '放大 SC-1 AI 换主题效果', '放大 SC-1 正面视图', '放大 SC-1 左侧视图'])
  assert.ok(first.textContent.includes('正面') && !first.textContent.includes('背面'))
  assert.ok(rows[1].textContent.includes('生成中') && rows[1].textContent.includes('未生成四面素材'))
  assert.equal(rows[1].querySelector('button[aria-label*="换主题效果"]'), null)
  assert.ok(rows[2].textContent.includes('未换主题') && rows[2].textContent.includes('未生成四面素材'))
  assert.equal(rows[2].querySelector('a[href^="/theme-jobs"], a[href^="/artwork-jobs"]'), null)
  assert.ok(rows[4].textContent.includes('参考方案'))
  toggle.click()
  await settle()
  assert.equal(mounted.container.querySelector('ul'), null)
  await mounted.close()
})

test('expansion is per record and enlarging a result opens the dialog', async () => {
  const mounted = await mount({ get: () => ({ items: [record(), record({ id: 'search-2', items: [scheme('SC-9')] })], total: 2, page: 1, pageSize: 20 }) })
  button(mounted.container.querySelector('[data-record="search-2"]'), '查看 1 套方案的成果').click()
  await settle()
  assert.equal(mounted.container.querySelectorAll('ul').length, 1)
  assert.ok(mounted.container.querySelector('[data-record="search-2"] ul'))
  assert.equal(button(mounted.container.querySelector('[data-record="search-1"]'), '查看 6 套方案的成果').getAttribute('aria-expanded'), 'false')
  mounted.container.querySelector('button[aria-label="放大 SC-9 原始方案"]').click()
  await settle()
  const dialog = document.body.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.ok(dialog.textContent.includes('SC-9 · 原始方案'))
  assert.equal(dialog.querySelector('img').getAttribute('src'), '/SC-9.jpg')
  await mounted.close()
})

test('records without generated content use one compact summary line', async () => {
  const mounted = await mount({ get: () => ({ items: [record({ items: [scheme('SC-1')], inputText: '' })], total: 1, page: 1, pageSize: 20 }) })
  assert.ok(mounted.container.textContent.includes('尚未生成主题或四面素材'))
  assert.equal(mounted.container.querySelector('blockquote'), null)
  assert.ok(!mounted.container.textContent.includes('“'))
  await mounted.close()
})

test('load failure keeps a retry action and unauthenticated users are sent to login with return path', async () => {
  let fail = true
  const mounted = await mount({ get: () => { if (fail) throw new Error('boom'); return { items: [], total: 0, page: 1, pageSize: 20 } } })
  assert.ok(mounted.container.querySelector('[role="alert"]').textContent.includes('加载失败，请重试。'))
  fail = false
  button(mounted.container, '重新加载').click()
  await settle()
  assert.ok(mounted.container.textContent.includes('暂无检索记录'))
  await mounted.close()
  const guest = await mount({ loggedIn: false })
  assert.equal(guest.calls.length, 0)
  button(guest.container, '去登录').click()
  await settle()
  assert.equal(guest.router.currentRoute.value.path, '/auth/sign-in')
  assert.equal(guest.router.currentRoute.value.query.redirect, '/my-searches')
  await guest.close()
})
