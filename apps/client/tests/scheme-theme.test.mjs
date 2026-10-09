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
for (const name of ['window', 'document', 'navigator', 'history', 'localStorage', 'sessionStorage', 'Storage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLSelectElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
registerTS(() => ts)
const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({
  root, configFile: false, server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      'vue-i18n': fileURLToPath(new URL('./mock-i18n.ts', import.meta.url)),
    },
  },
  plugins: [{
    name: 'test-scheme-theme', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/features/selection/SelectionShell.vue') || path.endsWith('/layouts/MainLayout.vue')) return '\0test-shell'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/composables/useCredits')) return '\0test-credits'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__schemeTheme.apiFetch(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__schemeTheme.auth'
      if (id === '\0test-credits') return "import { ref } from 'vue'; export const useCredits = () => ({ balance: ref(900), loading: ref(false), fetchBalance: () => globalThis.__schemeTheme.fetchBalance() })"
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
after(async () => { delete globalThis.__schemeTheme; await server.close(); await window.happyDOM.close() })
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: SchemeTheme } = await server.ssrLoadModule('/src/pages/SchemeTheme.vue')
const { writeSelectionSession } = await server.ssrLoadModule('/src/features/selection/session.ts')
const { emptyRequirement } = await server.ssrLoadModule('/src/features/selection/types.ts')
const { getVisitorId } = await server.ssrLoadModule('/src/lib/visitor-id.ts')

const endpoints = { scheme: '/api/v1/client/schemes/SC-6030', catalog: '/api/v1/client/catalog/options', models: '/api/v1/client/theme-models', offer: '/api/v1/client/theme-offers', job: '/api/v1/client/theme-jobs' }
const detail = {
  code: 'SC-6030',
  images: ['front', 'side'].map((assetId, order) => ({ assetId, url: `https://assets.example/${assetId}.jpg`, thumbnailUrl: `https://assets.example/${assetId}-thumb.jpg`, order, width: 1600, height: 1200 })),
}
const catalog = {
  industries: [{ id: 'industry-tech', label: '科技' }, { id: 'industry-energy', label: '能源' }],
  styles: [{ id: 'style-modern', label: '现代' }, { id: 'style-natural', label: '自然' }],
}
const initialParameters = { schemeCode: detail.code, sourceAssetId: 'front', input: { industryId: 'industry-tech', styleId: 'style-modern', brandColors: [], brandKeywords: '' }, requestedCount: 1, cacheMode: 'reuse', searchId: 'search-42' }
const offer = (id = 'offer-1', count = 1, unitCredits = 17) => ({
  available: true, blockedReasons: [],
  limits: { maxBrandColors: 3, maxKeywordCharacters: 200, allowedCounts: [1, 2, 3, 4] },
  supportedCombinations: catalog.industries.flatMap(industry => catalog.styles.map(style => ({ industryId: industry.id, styleId: style.id }))),
  offer: { id, expiresAt: new Date(Date.now() + 60_000).toISOString(), pricingRevision: 7, unitCredits, maxCredits: count * unitCredits, settlementRule: 'actual_success', cacheHit: false },
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await sleep(10) } }
async function debounce() { await sleep(430); await settle() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function mount({ path = '/schemes/SC-6030/theme?searchId=search-42', loggedIn = true, handlers = {}, waitForOffer = true, user = null, keepStorage = false } = {}) {
  if (!keepStorage) sessionStorage.clear()
  const calls = []
  const defaults = {
    [endpoints.scheme]: async () => detail,
    [endpoints.catalog]: async () => catalog,
    [endpoints.models]: async () => [{ id: 'primary', model: 'platform-primary', unitCredits: 17, revision: 7 }, { id: 'backup', model: 'platform-backup', unitCredits: 40, revision: 8 }],
    [endpoints.offer]: async body => offer(`offer-${calls.filter(call => call.path === endpoints.offer).length}`, body.requestedCount),
    [endpoints.job]: async () => ({ jobId: 'job-42', status: 'queued', pollAfterMs: 1000 }),
    ...handlers,
  }
  globalThis.__schemeTheme = {
    auth: { isLoggedIn: loggedIn, currentUser: user },
    fetchBalance: async () => { calls.push({ path: 'credits' }) },
    apiFetch: async (path, options) => {
      const body = options?.body
      calls.push({ path, ...(options ? { method: options.method, body: JSON.parse(JSON.stringify(body)) } : {}) })
      assert.ok(defaults[path], `Unexpected API: ${path}`)
      return { code: 0, data: await defaults[path](body) }
    },
  }
  const container = document.createElement('div')
  document.body.append(container)
  const router = createRouter({ history: createMemoryHistory(), routes: ['/schemes/:code/theme', '/ai-selection/preview/schemes/:code/theme', '/:pathMatch(.*)*'].map(path => ({ path, component: { render: () => null } })) })
  await router.push(path)
  await router.isReady()
  const app = createApp({ render: () => h(SchemeTheme) })
  app.use(router)
  app.mount(container)
  await settle()
  if (waitForOffer) await debounce()
  return { container, router, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}

function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
function callsTo(mounted, path) { return mounted.calls.filter(call => call.path === path) }
function costRegion(mounted) { return mounted.container.querySelector('[aria-live="polite"]') }
function input(element, value) {
  assert.ok(element, 'Input not found')
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
async function select(container, id, text) {
  const trigger = container.querySelector(`#${id}`)
  assert.equal(trigger.getAttribute('role'), 'combobox')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await settle()
  const option = [...document.querySelectorAll('[role="option"]')].find(el => el.textContent.trim() === text)
  assert.ok(option, `Select option not found: ${text}`)
  option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  assert.match(trigger.textContent, new RegExp(text))
}
async function openConfirmation(mounted) {
  button(mounted.container, '确认积分并生成').click()
  await settle()
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'Fresh available offer must open the real Dialog')
  return dialog
}
function confirmedFacts(dialog) {
  return Object.fromEntries([...dialog.querySelectorAll('dl > div')].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]))
}

test('initial valid offer uses real API payload and only industry/style Selects; platform model is informational with fallback', async () => {
  const mounted = await mount()
  try {
    assert.deepEqual(callsTo(mounted, endpoints.offer), [{ path: endpoints.offer, method: 'POST', body: initialParameters }])
    assert.equal(mounted.container.querySelectorAll('[role="combobox"]').length, 2)
    assert.equal(mounted.container.querySelectorAll('input[type="radio"]').length, 0)
    assert.match(costRegion(mounted).textContent, /1 张 · 单张 17 积分/)
    assert.match(costRegion(mounted).textContent, /最高锁定积分17 积分/)
    const explanation = mounted.container.querySelector('details')
    assert.match(explanation.textContent, /当前平台首选模型：platform-primary/)
    assert.match(explanation.textContent, /必要时自动回退/)
    assert.doesNotMatch(explanation.textContent, /platform-backup|40 积分/)
    assert.equal(button(mounted.container, '确认积分并生成').disabled, false)
  } finally { await mounted.close() }
})

test('count changes hide previous price immediately, debounce for 400ms, and reject out-of-order offer responses', async () => {
  const old = deferred()
  const newer = deferred()
  const mounted = await mount({ handlers: { [endpoints.offer]: body => body.requestedCount === 2 ? old.promise : body.requestedCount === 3 ? newer.promise : offer() } })
  try {
    button(mounted.container, '2 张').click()
    await nextTick()
    assert.doesNotMatch(costRegion(mounted).textContent, /单张 17|最高锁定积分/)
    assert.match(costRegion(mounted).textContent, /正在更新/)
    assert.equal(button(mounted.container, '确认积分并生成').disabled, true)
    await sleep(200)
    assert.equal(callsTo(mounted, endpoints.offer).length, 1)
    await sleep(230)
    await settle()
    assert.equal(callsTo(mounted, endpoints.offer).length, 2)
    button(mounted.container, '3 张').click()
    await debounce()
    assert.equal(callsTo(mounted, endpoints.offer).length, 3)
    newer.resolve(offer('newer', 3, 23))
    await settle()
    assert.match(costRegion(mounted).textContent, /3 张 · 单张 23 积分/)
    assert.match(costRegion(mounted).textContent, /最高锁定积分69 积分/)
    old.resolve(offer('older', 2, 900))
    await settle()
    assert.doesNotMatch(costRegion(mounted).textContent, /900|1800/)
    assert.match(costRegion(mounted).textContent, /最高锁定积分69 积分/)
    assert.deepEqual(callsTo(mounted, endpoints.offer).map(call => call.body.requestedCount), [1, 2, 3])
  } finally { old.resolve(offer()); newer.resolve(offer()); await mounted.close() }
})

test('real Selects, keywords, native color input and source image are sent to offer; invalid hex blocks requests and deletion is a button', async () => {
  const mounted = await mount()
  try {
    await select(mounted.container, 'theme-industry', '能源')
    await select(mounted.container, 'theme-style', '自然')
    input(mounted.container.querySelector('#theme-keywords'), '绿色环保')
    button(mounted.container, '添加品牌色').click()
    await nextTick()
    input(mounted.container.querySelector('input[type="color"]'), '#1a6b52')
    mounted.container.querySelector('[aria-label="查看第 2 张"]').click()
    await debounce()
    const expected = { ...initialParameters, sourceAssetId: 'side', input: { industryId: 'industry-energy', styleId: 'style-natural', brandColors: ['#1a6b52'], brandKeywords: '绿色环保' } }
    assert.deepEqual(callsTo(mounted, endpoints.offer).at(-1).body, expected)
    assert.equal(mounted.container.querySelector('[aria-label="查看第 2 张"]').getAttribute('aria-pressed'), 'true')
    assert.equal(mounted.container.querySelector('[aria-label="查看第 1 张"]').getAttribute('aria-pressed'), 'false')
    const colorText = mounted.container.querySelector('[aria-label="品牌色 1 色值"]')
    input(colorText, '#12zz00')
    await nextTick()
    assert.equal(colorText.getAttribute('aria-invalid'), 'true')
    const colorError = mounted.container.querySelector('#theme-color-0-error')
    assert.match(colorError.textContent, /品牌色 1.*六位色值/)
    assert.equal(colorText.getAttribute('aria-describedby'), colorError.id)
    assertSameNode(colorText.parentElement.parentElement, colorError.parentElement, "colorText.parentElement.parentElement vs colorError.parentElement")
    assert.equal(colorText.value, '#12zz00')
    assert.doesNotMatch(costRegion(mounted).textContent, /最高锁定积分/)
    const count = callsTo(mounted, endpoints.offer).length
    await debounce()
    assert.equal(callsTo(mounted, endpoints.offer).length, count)
    const primary = button(mounted.container, '确认积分并生成')
    assert.equal(primary.disabled, true)
    primary.click()
    await settle()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    const remove = mounted.container.querySelector('[aria-label="删除品牌色 1"]')
    assert.equal(remove.tagName, 'BUTTON')
    remove.click()
    await debounce()
    assertNoNode(mounted.container.querySelector('#theme-color-0-error'), "mounted.container.querySelector('#theme-color-0-error')")
    assertSameNode(document.activeElement, mounted.container.querySelector('#theme-add-color'), "document.activeElement vs mounted.container.querySelector('#theme-add-color')")
    assert.deepEqual(callsTo(mounted, endpoints.offer).at(-1).body, { ...expected, input: { ...expected.input, brandColors: [] } })
  } finally { await mounted.close() }
})

test('a refreshed keyword limit reports the error beside the field without discarding existing input', async () => {
  const mounted = await mount({ handlers: { [endpoints.offer]: body => {
    const result = offer('reduced-limit', body.requestedCount)
    if (body.input.brandKeywords) result.limits.maxKeywordCharacters = 3
    return result
  } } })
  try {
    const keywords = mounted.container.querySelector('#theme-keywords')
    input(keywords, '绿色环保品牌')
    await debounce()
    const error = mounted.container.querySelector('#theme-keywords-error')
    assert.match(error.textContent, /关键词超过字数限制/)
    assert.equal(keywords.getAttribute('aria-invalid'), 'true')
    assert.equal(keywords.getAttribute('aria-describedby'), error.id)
    assertSameNode(keywords.parentElement, error.parentElement, "keywords.parentElement vs error.parentElement")
    assert.equal(keywords.value, '绿色环保品牌')
    assert.equal(button(mounted.container, '确认积分并生成').disabled, true)
    assert.equal(callsTo(mounted, endpoints.job).length, 0)
    input(keywords, '环保')
    await debounce()
    assertNoNode(mounted.container.querySelector('#theme-keywords-error'), "mounted.container.querySelector('#theme-keywords-error')")
    assert.equal(keywords.getAttribute('aria-invalid'), 'false')
    assert.equal(button(mounted.container, '确认积分并生成').disabled, false)
    assert.equal(callsTo(mounted, endpoints.offer).at(-1).body.input.brandKeywords, '环保')
  } finally { await mounted.close() }
})

test('primary action waits for a new offer before opening confirmation and uses the refreshed price', async () => {
  const fresh = deferred()
  let attempts = 0
  const mounted = await mount({ handlers: { [endpoints.offer]: () => ++attempts === 1 ? offer() : fresh.promise } })
  try {
    const primary = button(mounted.container, '确认积分并生成')
    primary.click()
    primary.click()
    await settle()
    assert.equal(attempts, 2)
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assert.equal(primary.disabled, true)
    fresh.resolve(offer('fresh-confirmation', 1, 29))
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.deepEqual(confirmedFacts(dialog), { '生成数量': '1 张', '单张积分': '29 积分', '最高锁定积分': '29 积分' })
    assert.equal(callsTo(mounted, endpoints.job).length, 0)
  } finally { fresh.resolve(offer()); await mounted.close() }
})

test('refresh failure cannot confirm or create with the old offer and allows an explicit retry', async () => {
  let attempts = 0
  const mounted = await mount({ handlers: { [endpoints.offer]: () => { if (++attempts === 2) throw new Error('Network unavailable'); return offer(`offer-${attempts}`) } } })
  try {
    button(mounted.container, '确认积分并生成').click()
    await settle()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assert.match(costRegion(mounted).textContent, /积分费用获取失败/)
    assert.doesNotMatch(costRegion(mounted).textContent, /最高锁定积分/)
    assert.equal(callsTo(mounted, endpoints.job).length, 0)
    button(mounted.container, '重试获取积分').click()
    await settle()
    assert.match(costRegion(mounted).textContent, /单张 17 积分/)
    await openConfirmation(mounted)
    assert.equal(attempts, 4)
  } finally { await mounted.close() }
})

test('editing while confirmation refresh is pending invalidates that response without locking the form or opening a stale Dialog', async () => {
  const pending = deferred()
  let attempts = 0
  const mounted = await mount({ handlers: { [endpoints.offer]: body => ++attempts === 2 ? pending.promise : offer(`offer-${attempts}`, body.requestedCount) } })
  try {
    button(mounted.container, '确认积分并生成').click()
    await settle()
    const keywords = mounted.container.querySelector('#theme-keywords')
    assert.equal(mounted.container.querySelector('fieldset').disabled, false)
    input(keywords, '刷新期间继续编辑')
    await nextTick()
    pending.resolve(offer('stale-confirmation', 1, 900))
    await settle()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assert.doesNotMatch(costRegion(mounted).textContent, /900/)
    await debounce()
    assert.equal(attempts, 3)
    assert.equal(callsTo(mounted, endpoints.offer).at(-1).body.input.brandKeywords, '刷新期间继续编辑')
    await openConfirmation(mounted)
    assert.equal(attempts, 4)
    assert.equal(callsTo(mounted, endpoints.job).length, 0)
  } finally { pending.resolve(offer()); await mounted.close() }
})

test('controlled offer and creation HTTP 429 show a one-minute retry hint, keep input, and reuse the creation payload', async () => {
  let offers = 0
  let jobs = 0
  const mounted = await mount({ handlers: {
    [endpoints.offer]: body => { if (++offers === 2) throw { response: { status: 429 } }; return offer(`offer-${offers}`, body.requestedCount) },
    [endpoints.job]: () => { if (++jobs === 1) throw { statusCode: 429 }; return { jobId: 'job-after-rate-limit' } },
  } })
  try {
    input(mounted.container.querySelector('#theme-keywords'), '保留品牌输入')
    await debounce()
    assert.match(costRegion(mounted).querySelector('[role="alert"]').textContent, /稍等一分钟.*已填写内容保留/)
    assert.equal(mounted.container.querySelector('#theme-keywords').value, '保留品牌输入')
    assert.equal(callsTo(mounted, endpoints.job).length, 0)
    button(mounted.container, '重试获取积分').click()
    await settle()
    const dialog = await openConfirmation(mounted)
    button(dialog, '确认生成').click()
    await settle()
    assert.match(dialog.querySelector('[role="alert"]').textContent, /稍等一分钟.*已填写内容保留/)
    assert.equal(mounted.container.querySelector('#theme-keywords').value, '保留品牌输入')
    assert.equal(jobs, 1, '429 must not trigger an automatic creation retry')
    button(dialog, '重试确认生成').click()
    await settle()
    assert.equal(jobs, 2)
    assert.deepEqual(callsTo(mounted, endpoints.job)[1], callsTo(mounted, endpoints.job)[0])
    assert.equal(mounted.router.currentRoute.value.path, '/theme-jobs/job-after-rate-limit')
  } finally { await mounted.close() }
})

for (const [reason, message] of [
  ['SOURCE_UNAVAILABLE', /所选原图已不可用/],
  ['MODEL_UNAVAILABLE', /平台生成服务暂不可用/],
  ['SEARCH_UNAVAILABLE', /关联检索记录已不可用/],
]) {
  test(`offer ${reason} explains the failure in Chinese without opening confirmation or losing input`, async () => {
    let attempts = 0
    const mounted = await mount({ handlers: { [endpoints.offer]: () => { if (++attempts > 1) throw { data: { error: { reason } } }; return offer() } } })
    try {
      input(mounted.container.querySelector('#theme-keywords'), '保留关键词')
      await debounce()
      const alert = costRegion(mounted).querySelector('[role="alert"]')
      assert.match(alert.textContent, message)
      assert.match(alert.textContent, /已填写内容保留在当前页面/)
      assert.equal(mounted.container.querySelector('#theme-keywords').value, '保留关键词')
      button(mounted.container, '确认积分并生成').click()
      await settle()
      assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
      assert.equal(callsTo(mounted, endpoints.job).length, 0)
    } finally { await mounted.close() }
  })
}

test('Escape closes confirmation, restores the primary action focus, and reopening fetches a fresh unattempted offer', async () => {
  const mounted = await mount()
  try {
    const primary = button(mounted.container, '确认积分并生成')
    primary.focus()
    const dialog = await openConfirmation(mounted)
    const count = callsTo(mounted, endpoints.offer).length
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assertSameNode(document.activeElement, primary, "document.activeElement vs primary")
    await openConfirmation(mounted)
    assert.equal(callsTo(mounted, endpoints.offer).length, count + 1)
    assert.equal(callsTo(mounted, endpoints.job).length, 0)
  } finally { await mounted.close() }
})

test('confirmation count and credits match submission exactly, keeps searchId, prevents double creation and navigates on success', async () => {
  const created = deferred()
  const mounted = await mount({ handlers: { [endpoints.job]: () => created.promise } })
  try {
    input(mounted.container.querySelector('#theme-keywords'), '品牌科技')
    button(mounted.container, '3 张').click()
    await debounce()
    const dialog = await openConfirmation(mounted)
    const lastOffer = callsTo(mounted, endpoints.offer).at(-1)
    assert.deepEqual(confirmedFacts(dialog), { '生成数量': '3 张', '单张积分': '17 积分', '最高锁定积分': '51 积分' })
    const confirm = button(dialog, '确认生成')
    confirm.click()
    confirm.click()
    await settle()
    assert.equal(callsTo(mounted, endpoints.job).length, 1)
    const submission = callsTo(mounted, endpoints.job)[0]
    assert.equal(submission.method, 'POST')
    assert.match(submission.body.requestKey, /^[0-9a-f-]{36}$/i)
    assert.deepEqual(submission.body, { ...lastOffer.body, requestKey: submission.body.requestKey, offerId: `offer-${callsTo(mounted, endpoints.offer).length}` })
    assert.equal(button(dialog, '正在创建任务…').disabled, true)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    assert.ok(document.querySelector('[role="dialog"]'))
    created.resolve({ jobId: 'job-created', status: 'queued', pollAfterMs: 1000 })
    await settle()
    assert.equal(mounted.router.currentRoute.value.path, '/theme-jobs/job-created')
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
  } finally { created.resolve({ jobId: 'job-created' }); await mounted.close() }
})

test('network failure has feedback and retries the identical payload/requestKey, including closing and reopening confirmation', async () => {
  let attempts = 0
  const mounted = await mount({ handlers: { [endpoints.job]: () => { if (++attempts <= 2) throw new Error('Connection lost'); return { jobId: 'job-retried' } } } })
  try {
    let dialog = await openConfirmation(mounted)
    button(dialog, '确认生成').click()
    await settle()
    assert.match(dialog.querySelector('[role="alert"]').textContent, /复用同一请求，避免重复创建/)
    button(dialog, '重试确认生成').click()
    await settle()
    assert.equal(attempts, 2)
    assert.deepEqual(callsTo(mounted, endpoints.job)[1], callsTo(mounted, endpoints.job)[0])
    button(dialog, '返回调整').click()
    await settle()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /暂未确认任务是否创建成功/)
    const offerCount = callsTo(mounted, endpoints.offer).length
    button(mounted.container, '继续确认本次生成').click()
    await settle()
    dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.equal(callsTo(mounted, endpoints.offer).length, offerCount)
    button(dialog, '重试确认生成').click()
    await settle()
    assert.equal(attempts, 3)
    assert.deepEqual(callsTo(mounted, endpoints.job)[2], callsTo(mounted, endpoints.job)[0])
    assert.equal(mounted.router.currentRoute.value.path, '/theme-jobs/job-retried')
  } finally { await mounted.close() }
})

for (const reason of ['OFFER_EXPIRED', 'OFFER_STALE']) {
  test(`${reason} requires a fresh offer and a second explicit confirmation instead of repeating creation`, async () => {
    let attempts = 0
    const mounted = await mount({ handlers: { [endpoints.job]: () => { if (++attempts === 1) throw { data: { error: { reason } }, response: { status: 409 } }; return { jobId: 'job-renewed' } } } })
    try {
      let dialog = await openConfirmation(mounted)
      button(dialog, '确认生成').click()
      await settle()
      assert.match(dialog.querySelector('[role="alert"]').textContent, /重新获取积分并确认/)
      assert.equal([...dialog.querySelectorAll('button')].some(el => el.textContent.trim() === '重试确认生成'), false)
      const first = callsTo(mounted, endpoints.job)[0].body
      const offersBefore = callsTo(mounted, endpoints.offer).length
      button(dialog, '重新获取积分并确认').click()
      await settle()
      assert.equal(callsTo(mounted, endpoints.offer).length, offersBefore + 1)
      assert.equal(attempts, 1, 'Refreshing an offer must not auto-submit a job')
      dialog = document.querySelector('[role="dialog"]')
      assert.ok(dialog)
      button(dialog, '确认生成').click()
      await settle()
      const second = callsTo(mounted, endpoints.job)[1].body
      assert.notEqual(second.requestKey, first.requestKey)
      assert.notEqual(second.offerId, first.offerId)
      assert.deepEqual({ ...second, requestKey: first.requestKey, offerId: first.offerId }, first)
      assert.equal(mounted.router.currentRoute.value.path, '/theme-jobs/job-renewed')
    } finally { await mounted.close() }
  })
}

function selectionSession(searchId, requirement) {
  writeSelectionSession({ requirement: { ...emptyRequirement(), ...requirement }, text: '', state: 'idle', snapshot: '', parseResult: null, parsedText: null,
    parsedRequirement: null, liveMatchData: null, attemptId: 'attempt-1', visitorId: getVisitorId(), parseId: null, searchId, imagesExpiresAt: 0, activeImageByCode: {} })
}

test('industry and style default to those confirmed in the same AI selection search', async () => {
  selectionSession('search-42', { industryIds: ['industry-unknown', 'industry-energy'], styleIds: ['style-natural'] })
  const mounted = await mount({ keepStorage: true })
  try {
    assert.deepEqual(callsTo(mounted, endpoints.offer)[0].body.input, { ...initialParameters.input, industryId: 'industry-energy', styleId: 'style-natural' })
  } finally { await mounted.close() }
})

test('preferences from a different AI selection search are ignored', async () => {
  selectionSession('search-other', { industryIds: ['industry-energy'], styleIds: ['style-natural'] })
  const mounted = await mount({ keepStorage: true })
  try {
    assert.deepEqual(callsTo(mounted, endpoints.offer)[0].body, initialParameters)
  } finally { await mounted.close() }
})

test('an unconfirmed submission survives a reload, restores its parameters and the retry reuses the original request key', async () => {
  const user = { id: 'user-1' }
  let mounted = await mount({ user, handlers: { [endpoints.job]: () => { throw new Error('Connection lost') } } })
  let first
  try {
    input(mounted.container.querySelector('#theme-keywords'), '品牌科技')
    button(mounted.container, '2 张').click()
    await debounce()
    const dialog = await openConfirmation(mounted)
    button(dialog, '确认生成').click()
    await settle()
    first = callsTo(mounted, endpoints.job)[0].body
    assert.equal(first.requestedCount, 2)
  } finally { await mounted.close() }

  mounted = await mount({ user, keepStorage: true, handlers: { [endpoints.job]: async () => ({ jobId: 'job-recovered', status: 'queued', pollAfterMs: 1000 }) } })
  try {
    assert.equal(mounted.container.querySelector('#theme-keywords').value, '品牌科技')
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /上次提交尚未确认结果/)
    button(mounted.container, '继续确认本次生成').click()
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    button(dialog, '重试确认生成').click()
    await settle()
    assert.deepEqual(callsTo(mounted, endpoints.job)[0].body, first)
    assert.equal(mounted.router.currentRoute.value.path, '/theme-jobs/job-recovered')
    assert.equal(sessionStorage.getItem('booth:theme-request:user-1:SC-6030:search-42'), null)
  } finally { await mounted.close() }
})

test('a submission the server rejected is not restored after a reload', async () => {
  const user = { id: 'user-1' }
  let mounted = await mount({ user, handlers: { [endpoints.job]: () => { throw { data: { error: {} }, response: { status: 402 } } } } })
  try {
    const dialog = await openConfirmation(mounted)
    button(dialog, '确认生成').click()
    await settle()
    assert.equal(sessionStorage.getItem('booth:theme-request:user-1:SC-6030:search-42'), null)
  } finally { await mounted.close() }
  mounted = await mount({ user, keepStorage: true })
  try {
    assert.doesNotMatch(mounted.container.textContent, /上次提交尚未确认结果/)
    assert.ok(button(mounted.container, '确认积分并生成'))
  } finally { await mounted.close() }
})

test('unauthenticated login preserves the complete redirect and makes no offer/model/credits/job requests', async () => {
  const mounted = await mount({ loggedIn: false, waitForOffer: false })
  try {
    assertNoNode(mounted.container.querySelector('[role="combobox"]'), "mounted.container.querySelector('[role=\"combobox\"]')")
    button(mounted.container, '登录以继续').click()
    await settle()
    assert.equal(mounted.router.currentRoute.value.path, '/auth/sign-in')
    assert.equal(mounted.router.currentRoute.value.query.redirect, '/schemes/SC-6030/theme?searchId=search-42')
    await debounce()
    assert.deepEqual(mounted.calls.map(call => call.path).sort(), [endpoints.scheme, endpoints.catalog].sort())
  } finally { await mounted.close() }
})

test('static preview uses real disabled controls but makes no network or submission requests', async () => {
  const mounted = await mount({ path: '/ai-selection/preview/schemes/DEMO_63_001/theme?searchId=ignored', waitForOffer: false })
  try {
    assert.match(mounted.container.textContent, /静态示例 · 不可提交/)
    assert.match(costRegion(mounted).textContent, /示例模式不获取积分费用/)
    assert.equal(mounted.container.querySelector('fieldset').disabled, true)
    const primary = button(mounted.container, '示例模式 · 不可提交')
    assert.equal(primary.disabled, true)
    primary.click()
    button(mounted.container, '添加品牌色').click()
    await debounce()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assert.deepEqual(mounted.calls, [])
  } finally { await mounted.close() }
})

for (const [failedEndpoint, retry, errorText] of [
  [endpoints.catalog, '重试加载选项', /行业与风格加载失败/],
  [endpoints.scheme, '重新加载方案', /方案加载失败/],
]) {
  test(`${retry} recovers the failed load and only fetches offers after required data is available`, async () => {
    let attempts = 0
    const mounted = await mount({ handlers: { [failedEndpoint]: () => { if (++attempts === 1) throw new Error('Controlled load failure'); return failedEndpoint === endpoints.catalog ? catalog : detail } } })
    try {
      assert.match(mounted.container.querySelector('[role="alert"]').textContent, errorText)
      assert.equal(callsTo(mounted, endpoints.offer).length, 0)
      button(mounted.container, retry).click()
      await debounce()
      assert.equal(attempts, 2)
      assertNoNode(mounted.container.querySelector('[role="alert"]'), "mounted.container.querySelector('[role=\"alert\"]')")
      assert.deepEqual(callsTo(mounted, endpoints.offer)[0].body, initialParameters)
      assert.match(costRegion(mounted).textContent, /单张 17 积分/)
    } finally { await mounted.close() }
  })
}
