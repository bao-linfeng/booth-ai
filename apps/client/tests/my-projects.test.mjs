import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { assertNoNode } from './dom-assert.mjs'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'localStorage', 'sessionStorage', 'Storage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLSelectElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
window.localStorage.setItem('app-locale', 'zh')
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
    name: 'test-my-projects', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/features/selection/SelectionShell.vue')) return '\0test-shell'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/composables/useCredits')) return '\0test-credits'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__myProjects.apiFetch(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__myProjects.auth'
      if (id === '\0test-credits') return "import { ref } from 'vue'; export const useCredits = () => ({ balance: ref(null), loading: ref(false), signedInToday: ref(false), fetchBalance: async () => {}, signIn: async () => ({ success: true, amount: 1 }) })"
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
  delete globalThis.__myProjects
  await server.close()
  await window.happyDOM.close()
})
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: MyProjects } = await server.ssrLoadModule('/src/pages/MyProjects.vue')
const { pageContext } = (await server.ssrLoadModule('/src/features/customer-service/useCustomerService.ts')).useCustomerService()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await sleep(5) } }
const projectId = '33333333-3333-3333-3333-333333333333'
const exhibition = { name: '上海国际广告展', countryCode: 'CN', city: '上海', startDate: '2026-11-01', endDate: '2026-11-04' }
const catalog = {
  dimensions: {}, boothSpaces: [], openingCounts: [],
  productSystems: [{ id: 'sys-1', label: '标准展架体系' }], styles: [{ id: 'style-1', label: '科技感' }], industries: [{ id: 'ind-1', label: '电子' }],
  budgetTiers: [{ id: 'budget-1', label: '经济型' }], zones: [{ id: 'zone-1', label: '洽谈区' }, { id: 'zone-2', label: '仓储区' }],
  features: [{ id: 'feat-1', label: '大屏' }],
}
function summary(overrides = {}) {
  return { projectId, projectNo: 'PJ-2026-0001', schemeCode: 'SC-1', sourceType: 'quote_request', status: 'following', exhibition, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z', ...overrides }
}
function detail(overrides = {}) {
  return {
    ...summary(), revision: 3, artworkJobId: null, requestNo: 'QR-1',
    request: {
      exhibition, contact: { name: '张三', email: 'zhang@example.com', phone: '13800000000' }, company: '示例公司',
      scopeCodes: ['materials', 'installation'], scopeNotes: '含现场搭建', notes: '', materialBudget: { currency: 'CNY', amount: '50000' },
      originalDescription: '需要科技感展台',
      confirmedRequirements: { lengthMm: 6000, widthMm: 3000, maxHeightMm: 4500, areaM2: 18, openingCount: 2, productSystemId: 'sys-1', styleIds: ['style-1', 'missing-style'], industryIds: ['ind-1'], budgetTierId: 'budget-1', zoneIds: ['zone-1'], featureIds: [], keywords: ['LED'], requiredZoneIds: [], requiredFeatureIds: ['feat-1'], excludedZoneIds: ['zone-2'], excludedFeatureIds: [] },
      unresolvedQuestions: [], legacyIncomplete: false,
    },
    schemeSnapshot: { code: 'SC-1', name: '6×3 标准展台', revision: 2, lengthMm: 6000, widthMm: 3000, heightMm: 3500, openingCount: 2 },
    materialsStatus: { bom: 'available', drawings: 'available', artworks: 'pending' },
    selectedThemeSummary: { themeJobId: 'theme-1', resultId: 'result-1', selectionRevision: 1, previewUrl: '/theme.jpg' },
    publicResult: '报价单已发送至您的邮箱，请查收。',
    ...overrides,
  }
}
async function mount({ path = '/my-projects', loggedIn = true, list = () => ({ items: [summary()], total: 1, page: 1, pageSize: 10 }), get = () => detail(), options = () => catalog } = {}) {
  const calls = []
  globalThis.__myProjects = {
    auth: { isLoggedIn: loggedIn },
    apiFetch: async (url, init) => {
      calls.push({ url, init })
      let data
      if (url.startsWith('/api/v1/client/me/projects?')) data = await list(url)
      else if (url.startsWith('/api/v1/client/me/projects/')) data = await get(url.slice('/api/v1/client/me/projects/'.length))
      else if (url === '/api/v1/client/catalog/options') data = await options()
      else assert.fail(`Unexpected API: ${url}`)
      return { code: 0, data: structuredClone(data) }
    },
  }
  const router = createRouter({ history: createMemoryHistory(), routes: ['/my-projects', '/my-projects/:projectId', '/:pathMatch(.*)*'].map(route => ({ path: route, component: { render: () => null } })) })
  await router.push(path)
  await router.isReady()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(MyProjects) })
  app.use(router)
  app.mount(container)
  await settle()
  return { container, router, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}
const detailPath = `/my-projects/${projectId}`
function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
function card(container, title) {
  const found = [...container.querySelectorAll('h2')].find(element => element.textContent.trim() === title)
  assert.ok(found, `Section not found: ${title}`)
  return found.closest('[class*="rounded"]')
}

test('list cards lead with exhibition, status, next step and recent update in user language', async () => {
  const mounted = await mount({ list: () => ({ items: [summary(), summary({ projectId: 'p2', projectNo: 'PJ-2', sourceType: 'manual_request', schemeCode: null, status: 'quoted', exhibition: null })], total: 2, page: 1, pageSize: 10 }) })
  const cards = [...mounted.container.querySelectorAll('a[href^="/my-projects/"]')]
  assert.equal(cards.length, 2)
  const [first, second] = cards
  assert.equal(first.getAttribute('href'), detailPath)
  assert.equal(first.querySelector('h2').textContent.trim(), '上海国际广告展')
  for (const expected of ['跟进中', '下一步：顾问正在跟进', '报价申请', '方案 SC-1', '中国 / 上海', '2026-11-01 至 2026-11-04', '最近更新', 'PJ-2026-0001', '查看最新进展']) assert.ok(first.textContent.includes(expected), expected)
  assert.ok(second.textContent.includes('历史人工需求') && second.textContent.includes('人工需求 · 尚未关联方案') && second.textContent.includes('已报价') && second.textContent.includes('请查看最新进展中的报价说明'))
  assert.ok(!mounted.container.textContent.includes('公开进展'))
  assert.ok(!second.textContent.includes('undefined'))
  await mounted.close()
})

test('detail shows latest progress first, readable scope and requirement tags, and no JSON or raw codes', async () => {
  const mounted = await mount({ path: detailPath })
  const text = mounted.container.textContent
  const headings = [...mounted.container.querySelectorAll('h2')].map(element => element.textContent.trim())
  assert.deepEqual(headings, ['上海国际广告展', '最新进展', '申请内容', '方案与资料'])
  assert.ok(!text.includes('公开处理结果') && !text.includes('{') && !text.includes('materials') && !text.includes('installation') && !text.includes('sys-1') && !text.includes('style-1'))
  assert.ok(card(mounted.container, '最新进展').textContent.includes('报价单已发送至您的邮箱，请查收。'))
  assert.ok(text.includes('下一步：顾问正在跟进') && text.includes('跟进中') && text.includes('PJ-2026-0001'))
  const request = card(mounted.container, '申请内容').textContent
  for (const expected of ['中国 / 上海', '2026-11-01 至 2026-11-04', '示例公司 / 张三', 'zhang@example.com', '13800000000', 'CNY 50000', '材料采购', '搭建', '含现场搭建', '需要科技感展台', '6 m × 3 m', '18 ㎡', '2 面开口', '场馆限高 4.5 m', '标准展架体系', '科技感', '电子', '经济型', '洽谈区', '大屏', '仓储区', 'LED']) assert.ok(request.includes(expected), expected)
  assert.ok(!request.includes('missing-style'))
  assertNoNode(mounted.container.querySelector('pre'), "mounted.container.querySelector('pre')")
  assertNoNode(mounted.container.querySelector('details'), "mounted.container.querySelector('details')")
  assertNoNode(mounted.container.querySelector('ol, [class*="timeline"]'), "mounted.container.querySelector('ol, [class*=\"timeline\"]')")
  assert.ok(!text.includes('固定修订') && card(mounted.container, '方案与资料').textContent.includes('方案修订 2'))
  await mounted.close()
})

test('catalog failure still renders numeric specs and never exposes raw option IDs', async () => {
  const mounted = await mount({ path: detailPath, options: () => { throw new Error('catalog down') } })
  const request = card(mounted.container, '申请内容').textContent
  assert.ok(request.includes('6 m × 3 m') && request.includes('LED'))
  for (const raw of ['sys-1', 'style-1', 'ind-1', 'budget-1', 'zone-1', 'feat-1', 'q-1', '标准展架体系']) assert.ok(!request.includes(raw), raw)
  assertNoNode(mounted.container.querySelector('[role="alert"]'), "mounted.container.querySelector('[role=\"alert\"]')")
  await mounted.close()
})

test('detail without confirmed requirements does not fetch the catalog and legacy requests show placeholders', async () => {
  const base = detail()
  const mounted = await mount({ path: detailPath, get: () => detail({ sourceType: 'manual_request', schemeCode: null, schemeSnapshot: null, selectedThemeSummary: null, publicResult: null, request: { ...base.request, exhibition: null, company: undefined, contact: { name: '李四', legacyDetail: '微信 lisi' }, scopeCodes: [], scopeNotes: undefined, materialBudget: null, originalDescription: undefined, confirmedRequirements: undefined } }) })
  assert.ok(!mounted.calls.some(call => call.url.includes('catalog')))
  const text = mounted.container.textContent
  assert.ok(text.includes('历史人工需求') && text.includes('顾问正在处理，暂未发布进展。') && text.includes('尚未关联方案，顾问将与您沟通确认。') && text.includes('微信 lisi'))
  assert.ok(!text.includes('undefined') && !text.includes('null'))
  assert.equal((text.match(/待补充/g) ?? []).length >= 4, true)
  await mounted.close()
})

test('artwork actions keep their conditions and material statuses use user-facing names', async () => {
  const supplement = await mount({ path: detailPath })
  const section = card(supplement.container, '方案与资料').textContent
  for (const expected of ['物料清单：已附带', '三视图：已附带', '四面素材：待补充', '6×3 标准展台', '6 × 3 m · 高 3.5 m · 2 面开口']) assert.ok(section.includes(expected), expected)
  const link = [...supplement.container.querySelectorAll('a')].find(item => item.textContent.includes('生成并补充项目四面素材'))
  assert.equal(link.getAttribute('href'), `/schemes/SC-1/artwork?themeJobId=theme-1&projectId=${projectId}`)
  await supplement.close()
  const closed = await mount({ path: detailPath, get: () => detail({ status: 'lost' }) })
  assert.ok(![...closed.container.querySelectorAll('a')].some(item => item.textContent.includes('生成并补充')))
  await closed.close()
  const delivered = await mount({ path: detailPath, get: () => detail({ artworkJobId: 'art-1', materialsStatus: { bom: 'available', drawings: 'missing', artworks: 'available' } }) })
  assert.ok([...delivered.container.querySelectorAll('a')].some(item => item.getAttribute('href') === `/artwork-jobs/art-1?projectId=${projectId}`))
  assert.ok(card(delivered.container, '方案与资料').textContent.includes('三视图：暂无资料'))
  await delivered.close()
})

test('refresh progress reloads the project and failures keep a retry action', async () => {
  let result = '处理中'
  const mounted = await mount({ path: detailPath, get: () => detail({ publicResult: result }) })
  result = '已完成报价'
  button(mounted.container, '刷新进展').click()
  await settle()
  assert.ok(card(mounted.container, '最新进展').textContent.includes('已完成报价'))
  await mounted.close()
  let missing = true
  const failed = await mount({ path: detailPath, get: () => { if (missing) throw Object.assign(new Error('nf'), { response: { status: 404 } }); return detail() } })
  assert.ok(failed.container.querySelector('[role="alert"]').textContent.includes('项目不存在或不属于当前账户。'))
  missing = false
  button(failed.container, '重新加载').click()
  await settle()
  assertNoNode(failed.container.querySelector('[role="alert"]'), "failed.container.querySelector('[role=\"alert\"]')")
  assert.ok(failed.container.textContent.includes('最新进展'))
  await failed.close()
})

test('the loaded detail registers its project for "send this project" in the chat panel and clears it on the list, on errors and on leave', async () => {
  const mounted = await mount({ path: detailPath })
  assert.deepEqual(pageContext.value, { context: { kind: 'project', projectId }, entryPoint: 'my_project', label: 'PJ-2026-0001' })
  await mounted.router.push('/my-projects')
  await settle()
  assert.equal(pageContext.value, null, 'the list page has no project to send')
  await mounted.router.push(detailPath)
  await settle()
  assert.equal(pageContext.value?.label, 'PJ-2026-0001')
  await mounted.close()
  assert.equal(pageContext.value, null, 'leaving the page clears it')
  const failed = await mount({ path: detailPath, get: () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }) } })
  assert.equal(pageContext.value, null, 'a project that failed to load is never offered')
  await failed.close()
})

test('unauthenticated visitors are sent to login with the current route and make no requests', async () => {
  const mounted = await mount({ path: detailPath, loggedIn: false })
  assert.equal(mounted.calls.length, 0)
  button(mounted.container, '登录并返回').click()
  await settle()
  assert.equal(mounted.router.currentRoute.value.path, '/auth/sign-in')
  assert.equal(mounted.router.currentRoute.value.query.redirect, detailPath)
  await mounted.close()
})
const otherProjectId = '44444444-4444-4444-4444-444444444444'
for (const late of ['success', 'failure']) {
  test(`a late ${late} of the previous project never overwrites the project now shown or its chat context`, async () => {
    let releaseFirst
    const mounted = await mount({ path: detailPath, get: id => id === projectId
      ? new Promise((resolve, reject) => { releaseFirst = () => late === 'success' ? resolve(detail()) : reject(Object.assign(new Error('HTTP 500'), { response: { status: 500 } })) })
      : detail({ projectId: otherProjectId, projectNo: 'PJ-2026-0002' }) })
    try {
      await mounted.router.push(`/my-projects/${otherProjectId}`); await settle()
      assert.match(mounted.container.textContent, /PJ-2026-0002/)
      releaseFirst(); await settle()
      assert.match(mounted.container.textContent, /PJ-2026-0002/)
      assert.doesNotMatch(mounted.container.textContent, /PJ-2026-0001/)
      assert.doesNotMatch(mounted.container.textContent, /项目读取失败/)
      assert.equal(pageContext.value?.label, 'PJ-2026-0002')
    } finally { await mounted.close() }
  })
}
test('detail shows the original requirement, the remarks and the questions to confirm side by side', async () => {
  const full = detail()
  let mounted = await mount({ path: detailPath, get: () => ({ ...full, request: { ...full.request, notes: '请在周五前回复', unresolvedQuestions: ['开口数待确认', '是否需要储物间'] } }) })
  try {
    for (const text of ['需求描述', '需要科技感展台', '备注', '请在周五前回复', '待确认事项', '开口数待确认', '是否需要储物间']) assert.match(mounted.container.textContent, new RegExp(text))
  } finally { await mounted.close() }
  mounted = await mount({ path: detailPath, get: () => ({ ...full, request: { ...full.request, originalDescription: undefined, confirmedRequirements: undefined, notes: '只有备注的历史申请' } }) })
  try {
    assert.match(mounted.container.textContent, /备注只有备注的历史申请/)
    assert.doesNotMatch(mounted.container.textContent, /需求描述|待确认事项/)
  } finally { await mounted.close() }
})
