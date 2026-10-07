import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

// 跨页面交接回归：同一个应用、同一个路由里依次走 智选 → 方案详情 → 报价申请，三页都用真实组件。
// 只 mock 网络层与登录态，sessionStorage 的写入与读取全部由页面自己完成，任一侧的会话结构或版本漂移都会在这里失败。
const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'localStorage', 'sessionStorage', 'Storage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLSelectElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value() {} })
registerTS(() => ts)
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      'vue-i18n': fileURLToPath(new URL('./mock-i18n.ts', import.meta.url)),
    },
  },
  plugins: [{
    name: 'test-selection-quote-flow', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/layouts/MainLayout.vue') || path.endsWith('/features/selection/SelectionShell.vue')) return '\0test-shell'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/composables/useCredits')) return '\0test-credits'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory, RouterView } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const getVisitorId = () => 'visitor-1'; export const rotateVisitorId = () => 'visitor-2'; export const apiFetch = (...args) => globalThis.__selectionQuote.apiFetch(...args); export const lingtongPublicFetch = (...args) => globalThis.__selectionQuote.dictionary(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__selectionQuote.auth'
      if (id === '\0test-credits') return "import { ref } from 'vue'; export const useCredits = () => ({ loading: ref(false), signedInToday: ref(false), fetchBalance: async () => {}, signIn: async () => ({ success: true, amount: 1 }) })"
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
after(async () => { delete globalThis.__selectionQuote; await server.close(); await window.happyDOM.close() })
const { createApp, h, nextTick, createRouter, createMemoryHistory, RouterView } = await server.ssrLoadModule('virtual:test-vue')
const { default: AISelection } = await server.ssrLoadModule('/src/pages/AISelection.vue')
const { default: SchemeDetail } = await server.ssrLoadModule('/src/pages/SchemeDetail.vue')
const { default: QuoteRequest } = await server.ssrLoadModule('/src/pages/QuoteRequest.vue')

const user = { id: 'test-user', username: '测试用户', nickname: '测试用户', city: '上海', email: '', mobile: '', company: '' }
const description = '6x3 科技展台，希望有洽谈区'
const difference = { field: 'maxHeightMm', requested: '4 m', actual: '4.5 m', reason: '高度略高于需求' }
const catalog = {
  dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] },
  boothSpaces: [{ id: '6x3', label: '6x3', lengthMm: 6000, widthMm: 3000, heightMm: 3000 }],
  openingCounts: [{ id: '2', label: '2 面开口' }],
  productSystems: [], styles: [], industries: [], budgetTiers: [], zones: [{ id: 'meeting', label: '洽谈区' }], features: [],
}
const specifications = { lengthMm: 6000, widthMm: 3000, heightMm: 4500, areaM2: 18, openingCount: 2, productSystemId: 'standard', productSystemLabel: '标准模块' }
const image = { assetId: 'front', url: '/front.jpg', thumbnailUrl: '/front-thumb.jpg', order: 0, width: 1600, height: 1200 }
const detail = {
  code: 'SC-6030', images: [image], specifications,
  resources: { model: true, bom: true, renderings: true, masks: true, drawings: true, artworks: true },
  actions: { theme: 'available', quote: 'available', bom: 'available', drawings: 'available', artworks: 'available', modelDownload: 'available' },
}
// 报价表单本身不是本测试关注点：预先放入合法草稿，只验证智选上下文是否随提交带出
const quoteDraftKey = 'booth:quote-draft:SC-6030:standard:pending'
const validForm = { exhibitionName: '上海测试展', countryCode: 'CN', city: '上海', startDate: '2026-11-01', endDate: '2026-11-04', scopeCodes: ['materials'], scopeNotes: '', currency: 'CNY', amount: '30000', customerType: 'individual', company: '', contactName: '王测试', email: 'test@example.com', phone: '', notes: '' }

function matchResponse(body) {
  const item = { code: 'SC-6030', matchType: 'reference', images: [image], specifications,
    reasons: ['尺寸满足需求'], differences: [difference], pendingConfirmations: [{ type: 'missing_field', message: '开口方向待确认' }], preferenceMisses: [] }
  return {
    status: 'matched', mode: body.mode, requirement: body.requirement, items: [item],
    counts: { direct: 0, reference: 1, random: 0, total: 1 },
    diagnostics: { reviewedPublished: 1, ready: 1, exclusions: { unverifiedChecklist: 0, incompleteAssets: 0, invalidData: 0, productSystem: 0, height: 0, tags: 0, dimensions: 0 } },
    reasons: [], suggestions: [], missingFields: [], attemptId: body.attemptId, searchId: 'search-1',
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 6; i++) { await nextTick(); await sleep(5) } }

async function mount() {
  sessionStorage.clear()
  sessionStorage.setItem(quoteDraftKey, JSON.stringify({ owner: user.id, form: validForm, pending: null, pendingManual: null }))
  const calls = []
  globalThis.__selectionQuote = {
    auth: { isLoggedIn: true, currentUser: user },
    dictionary: async path => ({ data: path.endsWith('queryCountries') ? [{ dictKey: 'CN', dictValue: '中国' }] : [{ dictKey: 'SH', dictValue: '上海' }] }),
    apiFetch: async (path, options) => {
      const call = JSON.parse(JSON.stringify({ path, method: options?.method ?? 'GET', body: options?.body }))
      calls.push(call)
      if (path.startsWith('/api/v1/client/catalog/options')) return { code: 0, data: structuredClone(catalog) }
      if (path === '/api/v1/client/requirements/parse') return { code: 0, data: {
        status: 'ready', requirement: call.body.form, parser: 'rules', degraded: false,
        fieldSources: {}, overrides: [], clarifications: [], unhandledText: [], warnings: [], attemptId: call.body.attemptId, parseId: 'parse-1',
      } }
      if (path === '/api/v1/client/scheme-matches') return { code: 0, data: matchResponse(call.body) }
      if (path === '/api/v1/client/schemes/SC-6030') return { code: 0, data: structuredClone(detail) }
      if (path.endsWith('/quote-context')) return { code: 0, data: { schemeCode: 'SC-6030', schemeRevision: 1, bomRevision: 7, drawingRevision: 1, artworkRevision: 1, materialsStatus: { bom: 'available', drawings: 'available', artworks: 'available' } } }
      if (path === '/api/v1/client/quote-requests') return { code: 0, data: { projectId: 'project-1', projectNo: 'PJ-001', requestNo: 'REQ-001', status: 'pending', revision: 1 } }
      assert.fail(`Unexpected API: ${call.method} ${path}`)
    },
  }
  const container = document.createElement('div'); document.body.append(container)
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/ai-selection', component: AISelection },
    { path: '/schemes/:code', component: SchemeDetail },
    { path: '/schemes/:code/quote', name: 'QuoteRequest', component: QuoteRequest },
    { path: '/:pathMatch(.*)*', component: { render: () => null } },
  ] })
  await router.push('/ai-selection'); await router.isReady()
  const app = createApp({ render: () => h(RouterView) }); app.use(router); app.mount(container); await settle()
  return { container, router, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}

function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim().startsWith(text))
  assert.ok(found, `Button not found: ${text}`)
  return found
}
function link(container, pathname) {
  const found = [...container.querySelectorAll('a')].find(element => new URL(element.href).pathname === pathname)
  assert.ok(found, `Link not found: ${pathname}`)
  return found
}
async function input(container, selector, value) {
  const element = container.querySelector(selector)
  assert.ok(element, `Missing input ${selector}`)
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
async function navigate(mounted, anchor) {
  anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  await settle()
  return mounted.router.currentRoute.value
}
async function selectAndOpenQuote(mounted) {
  await input(mounted.container, '#requirement-text', description)
  button(mounted.container, '匹配方案').click(); await settle()
  const detailRoute = await navigate(mounted, link(mounted.container, '/schemes/SC-6030'))
  assert.equal(detailRoute.path, '/schemes/SC-6030')
  assert.equal(detailRoute.query.searchId, 'search-1')
  return link(mounted.container, '/schemes/SC-6030/quote')
}
async function submitQuote(mounted) {
  mounted.container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
  const posts = mounted.calls.filter(call => call.path === '/api/v1/client/quote-requests')
  assert.equal(posts.length, 1)
  assert.match(mounted.container.textContent, /申请已受理/)
  return posts[0].body
}
const parsedRequirement = mounted => mounted.calls.find(call => call.path === '/api/v1/client/scheme-matches').body.requirement

test('selection → detail → quote: the quote carries the original description, confirmed requirements and matching summary', async () => {
  const mounted = await mount()
  try {
    const quoteRoute = await navigate(mounted, await selectAndOpenQuote(mounted))
    assert.equal(quoteRoute.path, '/schemes/SC-6030/quote')
    assert.equal(quoteRoute.query.searchId, 'search-1')
    assert.match(mounted.container.textContent, /4 m → 4\.5 m：高度略高于需求/)
    assert.match(mounted.container.textContent, /开口方向待确认/)
    const body = await submitQuote(mounted)
    assert.deepEqual(body.requirementContext, { originalDescription: description, confirmedRequirements: parsedRequirement(mounted) })
    assert.equal(body.schemeCode, 'SC-6030')
    assert.equal(body.entryPoint, 'scheme_detail')
  } finally { await mounted.close() }
})

test('selection → detail → quote: a quote link carrying another search id does not attach the current session context', async () => {
  const mounted = await mount()
  try {
    const quoteLink = await selectAndOpenQuote(mounted)
    const staleHref = new URL(quoteLink.href)
    staleHref.searchParams.set('searchId', 'search-old')
    await mounted.router.push(staleHref.pathname + staleHref.search); await settle()
    assert.doesNotMatch(mounted.container.textContent, /高度略高于需求/)
    const body = await submitQuote(mounted)
    assert.equal('requirementContext' in body, false)
  } finally { await mounted.close() }
})

test('selection → quote: editing requirements after matching drops the context instead of attaching stale conditions', async () => {
  const mounted = await mount()
  try {
    await input(mounted.container, '#requirement-text', description)
    button(mounted.container, '匹配方案').click(); await settle()
    button(mounted.container, '修改需求').click(); await settle()
    await input(mounted.container, '#requirement-text', '改成医疗展台')
    await mounted.router.push({ path: '/schemes/SC-6030/quote', query: { entryPoint: 'scheme_detail', searchId: 'search-1' } }); await settle()
    assert.doesNotMatch(mounted.container.textContent, /高度略高于需求/)
    const body = await submitQuote(mounted)
    assert.equal('requirementContext' in body, false)
  } finally { await mounted.close() }
})
