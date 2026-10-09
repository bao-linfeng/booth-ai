import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { assertNoNode, assertSameNode } from './dom-assert.mjs'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'sessionStorage', 'localStorage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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
    name: 'test-ai-selection', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/layouts/MainLayout.vue')) return '\0test-layout'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/composables/useCredits')) return '\0test-credits'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-layout') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__aiSelection.apiFetch(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__aiSelection.auth'
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
after(async () => {
  delete globalThis.__aiSelection
  await server.close()
  await window.happyDOM.close()
})
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: AISelection } = await server.ssrLoadModule('/src/pages/AISelection.vue')
const { emptyRequirement } = await server.ssrLoadModule('/src/features/selection/types.ts')
const { readManualHandoff, readSelectionQuoteHandoff, writeManualHandoff } = await server.ssrLoadModule('/src/features/selection/handoff.ts')
const sessionKey = 'booth-ai:ai-selection'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await sleep(5) } }
const catalog = {
  dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] },
  boothSpaces: [
    { id: '6x3', label: '6x3', lengthMm: 6000, widthMm: 3000, heightMm: 3000 },
    { id: '6x4', label: '6x4', lengthMm: 6000, widthMm: 4000, heightMm: 3000 },
  ],
  openingCounts: [{ id: '2', label: '2 面开口' }],
  productSystems: [], styles: [], industries: [{ id: 'medical', label: '医疗健康' }], budgetTiers: [],
  zones: [{ id: 'meeting', label: '洽谈区' }], features: [],
}
function matchResponse(body, status) {
  const random = body.mode === 'random'
  const items = status === 'no_match' ? [] : [{
    code: 'SC-6030', matchType: random ? 'random' : 'direct',
    images: [{ assetId: 'front', url: '/front.jpg', thumbnailUrl: '/front-thumb.jpg', order: 0, width: 1600, height: 1200 }],
    specifications: { lengthMm: 6000, widthMm: 3000, heightMm: 3000, areaM2: 18, openingCount: 2, productSystemId: 'standard', productSystemLabel: '标准模块' },
    reasons: random ? [] : ['尺寸满足需求'], differences: [], pendingConfirmations: [], preferenceMisses: [],
  }]
  return {
    status, mode: body.mode, requirement: body.requirement, items,
    counts: { direct: random ? 0 : items.length, reference: 0, random: random ? items.length : 0, total: items.length },
    diagnostics: { reviewedPublished: 1, ready: 1, exclusions: { unverifiedChecklist: 0, incompleteAssets: 0, invalidData: 0, productSystem: 0, height: 0, tags: 0, dimensions: 0 } },
    reasons: status === 'no_match' ? ['暂无符合尺寸的方案'] : [], suggestions: [], missingFields: [],
    attemptId: body.attemptId, searchId: 'search-1',
  }
}
async function mount({ restore = false, status = 'matched', schemeImages, parsed = {} } = {}) {
  if (!restore) sessionStorage.clear()
  const calls = []
  globalThis.__aiSelection = {
    auth: { isLoggedIn: false, currentUser: null },
    apiFetch: async (path, options) => {
      const call = JSON.parse(JSON.stringify({ path, options }))
      calls.push(call)
      if (path.startsWith('/api/v1/client/catalog/options')) return { code: 0, data: structuredClone(catalog) }
      if (path === '/api/v1/client/requirements/parse') return { code: 0, data: {
        status: 'ready', requirement: { ...call.options.body.form, ...parsed }, parser: 'rules', degraded: false,
        fieldSources: {}, overrides: [], clarifications: [], unhandledText: [], warnings: [],
        attemptId: call.options.body.attemptId, parseId: 'parse-1',
      } }
      if (path === '/api/v1/client/scheme-matches') return { code: 0, data: matchResponse(call.options.body, status) }
      if (path.startsWith('/api/v1/client/schemes/') && schemeImages) return { code: 0, data: { images: structuredClone(schemeImages) } }
      assert.fail(`Unexpected API: ${path}`)
    },
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/ai-selection')
  await router.isReady()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(AISelection) })
  app.use(router)
  app.mount(container)
  await settle()
  return { container, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}
function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim().startsWith(text))
  assert.ok(found, `Button not found: ${text}`)
  return found
}
async function click(container, text) { button(container, text).click(); await settle() }
async function input(container, selector, value) {
  const element = container.querySelector(selector)
  assert.ok(element, `Missing input ${selector}`)
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
async function selectSize(container, label = '6x3') {
  const trigger = container.querySelector('[aria-label="方案尺寸"]')
  assert.ok(trigger, 'Missing 方案尺寸 select trigger')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await nextTick(); await nextTick()
  const options = [...document.querySelectorAll('[role="option"]')]
  const target = options.find(option => option.textContent.trim() === label)
  assert.ok(target, `Option not found: ${label}`)
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 0))
  await settle()
}
const posts = mounted => mounted.calls.filter(call => call.options?.method === 'POST')
const saved = () => JSON.parse(sessionStorage.getItem(sessionKey))
function assertEditor(container, visible) {
  assert.equal(!!container.querySelector('#requirement-editor'), visible)
  assert.equal(!!container.querySelector('#requirement-text'), visible)
  assert.equal(!!container.querySelector('[aria-label="当前需求摘要"]'), !visible)
}

test('fresh entry shows the lightweight editor with no automatic search and height beside size in the primary row', async () => {
  const mounted = await mount()
  try {
    assertEditor(mounted.container, true)
    assert.equal(mounted.container.querySelector('#requirement-text').value, '')
    assert.ok(mounted.container.querySelector('[aria-label="方案尺寸"]'))
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').value, '')
    assert.equal(button(mounted.container, '更多条件').getAttribute('aria-expanded'), 'false')
    assert.equal(button(mounted.container, '匹配方案').disabled, false)
    assert.equal(posts(mounted).length, 0)
    assert.equal(mounted.container.querySelector('fieldset').textContent.includes('重置'), false)
  } finally { await mounted.close() }
})

test('examples only fill text on fresh entry without parsing or matching', async () => {
  const mounted = await mount()
  try {
    for (const [label, text] of [['简约洽谈空间', '长6米、宽3米，现代简约风格，需要洽谈区'], ['医疗 · 带储藏间', '医疗健康行业，必须有储藏间']]) {
      await click(mounted.container, label)
      assert.equal(mounted.container.querySelector('#requirement-text').value, text)
      assertEditor(mounted.container, true)
      assert.equal(posts(mounted).length, 0)
      assert.equal(saved().state, 'idle')
      assert.deepEqual(saved().requirement, emptyRequirement())
    }
  } finally { await mounted.close() }
})

test('random submit and session reload keep the editor beside inspiration results without another search', async () => {
  let mounted = await mount()
  try {
    await click(mounted.container, '先看展台灵感')
    assert.equal(posts(mounted).length, 1)
    assert.equal(posts(mounted)[0].path, '/api/v1/client/scheme-matches')
    assert.equal(posts(mounted)[0].options.body.mode, 'random')
    assert.equal(posts(mounted)[0].options.body.inputContext.textProvided, false)
    assertEditor(mounted.container, true)
    assert.match(mounted.container.textContent, /先看看展台灵感/)
    assert.match(mounted.container.textContent, /SC-6030/)
    assert.equal(saved().state, 'results')
    await mounted.close()
    mounted = await mount({ restore: true })
    assertEditor(mounted.container, true)
    assert.match(mounted.container.textContent, /灵感推荐 · 尚未按需求筛选/)
    assert.match(mounted.container.textContent, /SC-6030/)
    assert.equal(posts(mounted).length, 0)
    assert.equal(saved().liveMatchData.mode, 'random')
  } finally { await mounted.close() }
})

test('filtered form submit collapses to a condition summary and restores that summary on reload', async () => {
  let mounted = await mount()
  try {
    await selectSize(mounted.container, '6x3')
    await click(mounted.container, '匹配方案')
    assert.equal(posts(mounted).length, 1)
    assert.equal(posts(mounted)[0].options.body.mode, 'filtered')
    assert.equal(posts(mounted)[0].options.body.requirement.areaM2, 18)
    assertEditor(mounted.container, false)
    const summary = mounted.container.querySelector('[aria-label="当前需求摘要"]')
    for (const text of ['长 6 m', '宽 3 m', '18 ㎡', '查看全部 4 项条件']) assert.ok(summary.textContent.includes(text), text)
    assert.equal(button(summary, '修改需求').getAttribute('aria-expanded'), 'false')
    assert.match(mounted.container.textContent, /为您找到的空间方案/)
    await mounted.close()
    mounted = await mount({ restore: true })
    assertEditor(mounted.container, false)
    assert.match(mounted.container.querySelector('[aria-label="当前需求摘要"]').textContent, /18 ㎡/)
    assert.equal(posts(mounted).length, 0)
  } finally { await mounted.close() }
})

test('filtered summary includes selected industry and functional zones', async () => {
  const mounted = await mount()
  try {
    await click(mounted.container, '更多条件')
    await click(mounted.container, '医疗健康')
    await click(mounted.container, '洽谈区')
    assert.match(button(mounted.container, '更多条件').textContent, /已填 2 类/)
    await click(mounted.container, '匹配方案')
    const body = posts(mounted)[0].options.body
    assert.equal(body.mode, 'filtered')
    assert.deepEqual(body.requirement.industryIds, ['medical'])
    assert.deepEqual(body.requirement.zoneIds, ['meeting'])
    assertEditor(mounted.container, false)
    const summary = mounted.container.querySelector('[aria-label="当前需求摘要"]')
    for (const text of ['医疗健康', '洽谈区']) {
      assert.ok([...summary.querySelectorAll('div')].some(element => element.textContent.trim() === text), `Missing summary chip: ${text}`)
    }
  } finally { await mounted.close() }
})

test('text submit parses once, matches filtered and displays the submitted description in the summary', async () => {
  const mounted = await mount()
  try {
    await input(mounted.container, '#requirement-text', '科技展台，希望有洽谈区')
    await click(mounted.container, '匹配方案')
    assert.deepEqual(posts(mounted).map(call => call.path), ['/api/v1/client/requirements/parse', '/api/v1/client/scheme-matches'])
    const body = posts(mounted)[1].options.body
    assert.equal(body.mode, 'filtered')
    assert.equal(body.parseId, 'parse-1')
    assert.equal(body.inputContext.text, '科技展台，希望有洽谈区')
    assertEditor(mounted.container, false)
    assert.match(mounted.container.querySelector('[aria-label="当前需求摘要"]').textContent, /科技展台，希望有洽谈区/)
  } finally { await mounted.close() }
})

test('quote handoff reads the persisted filtered result, binds it to the search and scheme, and drops it once stale', async () => {
  const mounted = await mount()
  try {
    await input(mounted.container, '#requirement-text', '科技展台，希望有洽谈区')
    await click(mounted.container, '匹配方案')
    const handoff = readSelectionQuoteHandoff('SC-6030', 'search-1')
    assert.ok(handoff, 'Matched filtered session must hand off to quote')
    assert.equal(handoff.requirementContext.originalDescription, '科技展台，希望有洽谈区')
    assert.deepEqual(handoff.requirementContext.confirmedRequirements, saved().requirement)
    assert.deepEqual(handoff.matchingSummary, { matchType: 'direct', differences: [], pendingConfirmations: [] })
    assert.equal(readSelectionQuoteHandoff('SC-6030', undefined), null, 'Entry without the source search does not borrow the current result')
    assert.equal(readSelectionQuoteHandoff('SC-6030', 'search-old'), null)
    assert.equal(readSelectionQuoteHandoff('SC-9999', 'search-1'), null)
    await click(mounted.container, '修改需求')
    await input(mounted.container, '#requirement-text', '改成医疗展台')
    assert.equal(readSelectionQuoteHandoff('SC-6030', 'search-1'), null)
  } finally { await mounted.close() }
})

test('quote handoff ignores inspiration results that were not filtered by requirements', async () => {
  const mounted = await mount()
  try {
    await click(mounted.container, '先看展台灵感')
    assert.equal(saved().state, 'results')
    assert.equal(readSelectionQuoteHandoff('SC-6030', 'search-1'), null)
  } finally { await mounted.close() }
})

test('manual handoff carries the requirement context and only seeds the contact when no submission is in flight', () => {
  sessionStorage.clear()
  const context = { originalDescription: '科技展台', confirmedRequirements: { ...emptyRequirement(), lengthMm: 6000 }, unresolvedQuestions: ['开口数？'] }
  writeManualHandoff(context, { owner: 'user-1', name: '王测试', contact: 'test@example.com' })
  assert.deepEqual(readManualHandoff(), context)
  assert.deepEqual(JSON.parse(sessionStorage.getItem('booth:manual-draft')), { owner: 'user-1', pending: null, pendingManual: null, form: { contactName: '王测试', email: 'test@example.com' } })
  const inFlight = { owner: 'user-1', form: { contactName: '旧联系人' }, pending: null, pendingManual: { requestKey: 'request-1' } }
  sessionStorage.setItem('booth:manual-draft', JSON.stringify(inFlight))
  writeManualHandoff({ ...context, originalDescription: '医疗展台' }, { owner: 'user-1', name: '李测试', contact: '13800000000' })
  assert.equal(readManualHandoff().originalDescription, '医疗展台')
  assert.deepEqual(JSON.parse(sessionStorage.getItem('booth:manual-draft')), inFlight)
})

test('manual handoff drops malformed or unparsable context', () => {
  sessionStorage.clear()
  for (const raw of [JSON.stringify({ originalDescription: '科技展台', confirmedRequirements: { lengthMm: '6' }, unresolvedQuestions: [] }), '{']) {
    sessionStorage.setItem('booth:manual-context', raw)
    assert.equal(readManualHandoff(), null)
    assert.equal(sessionStorage.getItem('booth:manual-context'), null)
  }
})

const freshFront = { assetId: 'front', url: '/front-fresh.jpg', thumbnailUrl: '/front-fresh-thumb.jpg', order: 0, width: 1600, height: 1200 }
for (const scenario of [
  { name: 'refreshes them by assetId and extends the deadline', images: [freshFront], url: '/front-fresh.jpg', extended: true },
  { name: 'keeps old links and the expired deadline when an asset is missing', images: [], url: '/front.jpg', extended: false },
]) {
  test(`restoring expired image links ${scenario.name}`, async () => {
    let mounted = await mount()
    try {
      await selectSize(mounted.container, '6x3')
      await click(mounted.container, '匹配方案')
      await mounted.close()
      sessionStorage.setItem(sessionKey, JSON.stringify({ ...saved(), imagesExpiresAt: 0, activeImageByCode: { 'SC-6030': 0 } }))
      mounted = await mount({ restore: true, schemeImages: scenario.images })
      assert.equal(mounted.calls.filter(call => call.path === '/api/v1/client/schemes/SC-6030').length, 1)
      assert.equal(posts(mounted).length, 0)
      assert.equal(saved().liveMatchData.items[0].images[0].url, scenario.url)
      assert.equal(saved().imagesExpiresAt > Date.now() + 200_000, scenario.extended)
      assert.deepEqual(saved().activeImageByCode, { 'SC-6030': 0 })
    } finally { await mounted.close() }
  })
}

for (const status of ['matched', 'no_match']) {
  test(`${status}: editing an outcome and choosing an example only fills a stale draft; reload shows the editor`, async () => {
    let mounted = await mount({ status })
    try {
      await selectSize(mounted.container, '6x3')
      await click(mounted.container, '匹配方案')
      assertEditor(mounted.container, false)
      await click(mounted.container, '修改需求')
      assertEditor(mounted.container, true)
      assertSameNode(document.activeElement, mounted.container.querySelector('#requirement-text'), "document.activeElement vs mounted.container.querySelector('#requirement-text')")
      const postCount = posts(mounted).length
      const snapshot = saved().snapshot
      await click(mounted.container, '医疗 · 带储藏间')
      assert.equal(mounted.container.querySelector('#requirement-text').value, '医疗健康行业，必须有储藏间')
      assert.equal(posts(mounted).length, postCount)
      assert.equal(saved().snapshot, snapshot)
      assert.equal(saved().state, status === 'matched' ? 'results' : 'empty')
      assert.match(mounted.container.textContent, /当前为上次匹配结果/)
      assert.equal([...mounted.container.querySelectorAll('button')].some(element => element.textContent.trim() === '收起编辑'), false)
      await mounted.close()
      mounted = await mount({ restore: true, status })
      assertEditor(mounted.container, true)
      assert.equal(mounted.container.querySelector('#requirement-text').value, '医疗健康行业，必须有储藏间')
      assert.match(mounted.container.textContent, /6x3/)
      assert.match(mounted.container.textContent, /当前为上次匹配结果/)
      assert.equal(posts(mounted).length, 0)
    } finally { await mounted.close() }
  })
}

test('changing form conditions keeps a stale draft visible after reload without reparsing or matching', async () => {
  let mounted = await mount()
  try {
    await selectSize(mounted.container, '6x3')
    await click(mounted.container, '匹配方案')
    await click(mounted.container, '修改需求')
    await selectSize(mounted.container, '6x4')
    assert.equal(saved().requirement.areaM2, 24)
    assert.match(mounted.container.textContent, /当前为上次匹配结果/)
    assert.equal(posts(mounted).length, 1)
    await mounted.close()
    mounted = await mount({ restore: true })
    assertEditor(mounted.container, true)
    assert.match(mounted.container.textContent, /6x4/)
    assert.match(mounted.container.textContent, /面积 24 ㎡/)
    assert.equal(posts(mounted).length, 0)
  } finally { await mounted.close() }
})

test('page reset clears the draft and previous outcome, returning to idle even after reload', async () => {
  let mounted = await mount()
  try {
    await selectSize(mounted.container, '6x3')
    await click(mounted.container, '匹配方案')
    await click(mounted.container, '修改需求')
    const reset = button(mounted.container, '重置需求')
    assertNoNode(reset.closest('fieldset'), "reset.closest('fieldset')")
    reset.click()
    await settle()
    assertEditor(mounted.container, true)
    assert.equal(mounted.container.querySelector('#requirement-text').value, '')
    assert.doesNotMatch(mounted.container.textContent, /为您找到的空间方案|当前为上次匹配结果|SC-6030/)
    assert.ok(button(mounted.container, '先看展台灵感'))
    assert.equal(sessionStorage.getItem(sessionKey), null)
    assert.equal(posts(mounted).length, 1)
    await mounted.close()
    mounted = await mount({ restore: true })
    assertEditor(mounted.container, true)
    assert.equal(posts(mounted).length, 0)
  } finally { await mounted.close() }
})

test('height is a primary field: validated, not counted as a more condition, and sent in millimetres', async () => {
  const mounted = await mount()
  try {
    const more = button(mounted.container, '更多条件')
    assert.equal(more.getAttribute('aria-expanded'), 'false')
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').value, '')
    await input(mounted.container, '#requirement-maxHeightMm', '4.2501')
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').getAttribute('aria-invalid'), 'true')
    assert.equal(button(mounted.container, '匹配方案').disabled, true)
    await input(mounted.container, '#requirement-maxHeightMm', '4.25')
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').getAttribute('aria-invalid'), 'false')
    assert.equal(more.textContent.includes('已填'), false)
    assert.equal(saved().requirement.maxHeightMm, 4250)
    await click(mounted.container, '匹配方案')
    assert.equal(posts(mounted).length, 1)
    assert.equal(posts(mounted)[0].options.body.mode, 'filtered')
    assert.equal(posts(mounted)[0].options.body.requirement.maxHeightMm, 4250)
    assertEditor(mounted.container, false)
    assert.match(mounted.container.querySelector('[aria-label="当前需求摘要"]').textContent, /限高 4.25 m/)
  } finally { await mounted.close() }
})

for (const [name, cleared] of [['backspacing to empty', ''], ['leaving only spaces', '   ']]) {
  test(`${name} after a parsed description matches by the form without an empty parse or the old parse record`, async () => {
    const mounted = await mount()
    try {
      await selectSize(mounted.container, '6x3')
      await input(mounted.container, '#requirement-text', '科技展台，希望有洽谈区')
      await click(mounted.container, '匹配方案')
      assert.equal(posts(mounted).length, 2)
      await click(mounted.container, '修改需求')
      await input(mounted.container, '#requirement-text', cleared)
      await click(mounted.container, '重新匹配方案')
      assert.deepEqual(posts(mounted).map(call => call.path), ['/api/v1/client/requirements/parse', '/api/v1/client/scheme-matches', '/api/v1/client/scheme-matches'])
      const body = posts(mounted)[2].options.body
      assert.equal(body.mode, 'filtered')
      assert.equal('parseId' in body, false)
      assert.equal(body.inputContext.textProvided, false)
      assert.match(mounted.container.textContent, /为您找到的空间方案/)
    } finally { await mounted.close() }
  })
}

test('the clear-description button drops the old parse record from the next search', async () => {
  const mounted = await mount()
  try {
    await selectSize(mounted.container, '6x3')
    await input(mounted.container, '#requirement-text', '科技展台，希望有洽谈区')
    await click(mounted.container, '匹配方案')
    await click(mounted.container, '修改需求')
    await click(mounted.container, '清空描述')
    await click(mounted.container, '重新匹配方案')
    assert.equal(posts(mounted).length, 3)
    const body = posts(mounted)[2].options.body
    assert.equal('parseId' in body, false)
    assert.equal(body.inputContext.textProvided, false)
  } finally { await mounted.close() }
})

test('a session saved under a previous visitor is not restored after the visitor ID rotates', async () => {
  let mounted = await mount()
  try {
    await selectSize(mounted.container, '6x3')
    await click(mounted.container, '匹配方案')
    assert.ok(saved())
    await mounted.close()
    localStorage.setItem('booth-ai:visitor-id', 'v_rotated_after_logout_0001')
    mounted = await mount({ restore: true })
    assertEditor(mounted.container, true)
    assert.doesNotMatch(mounted.container.textContent, /为您找到的空间方案|SC-6030/)
    assert.equal(posts(mounted).length, 0)
    assert.equal(sessionStorage.getItem(sessionKey), null)
  } finally { await mounted.close() }
})

test('a visitor change while the page stays open starts a new attempt instead of reusing the old IDs', async () => {
  const mounted = await mount()
  try {
    await selectSize(mounted.container, '6x3')
    await input(mounted.container, '#requirement-text', '科技展台，希望有洽谈区')
    await click(mounted.container, '匹配方案')
    const first = posts(mounted)[1].options.body
    localStorage.setItem('booth-ai:visitor-id', 'v_changed_in_another_tab_01')
    await click(mounted.container, '修改需求')
    await selectSize(mounted.container, '6x4')
    await click(mounted.container, '重新匹配方案')
    const next = posts(mounted).at(-1).options.body
    assert.equal(next.mode, 'filtered')
    assert.notEqual(next.attemptId, first.attemptId)
    assert.equal('parseId' in next, false)
    assert.equal(saved().visitorId, 'v_changed_in_another_tab_01')
  } finally { await mounted.close() }
})

test('a custom size parsed from the description is shown in the size select instead of the unrestricted placeholder', async () => {
  const mounted = await mount({ parsed: { lengthMm: 7000, widthMm: 4500, areaM2: 31.5 } })
  try {
    assert.match(mounted.container.querySelector('[aria-label="方案尺寸"]').textContent, /不限/)
    await input(mounted.container, '#requirement-text', '7米乘4.5米的展台')
    await click(mounted.container, '匹配方案')
    await click(mounted.container, '修改需求')
    assert.match(mounted.container.querySelector('[aria-label="方案尺寸"]').textContent, /自定义 7 × 4\.5 m/)
  } finally { await mounted.close() }
})
