import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'localStorage', 'sessionStorage', 'Storage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
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
    name: 'test-artwork-job', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/layouts/MainLayout.vue')) return '\0test-shell'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__artwork.apiFetch(...args); apiFetch.raw = (...args) => globalThis.__artwork.raw(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__artwork.auth'
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
const originalEventSource = globalThis.EventSource
globalThis.EventSource = class { constructor(url) { this.url = url } addEventListener() {} close() {} }
const downloads = []
const originalAnchorClick = window.HTMLAnchorElement.prototype.click
window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download) }
after(async () => {
  globalThis.EventSource = originalEventSource
  window.HTMLAnchorElement.prototype.click = originalAnchorClick
  delete globalThis.__artwork
  await server.close()
  await window.happyDOM.close()
})
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: ArtworkJob } = await server.ssrLoadModule('/src/pages/ArtworkJob.vue')

const createPath = '/schemes/SC-6030/artwork?themeJobId=theme-1'
const context = { schemeCode: 'SC-6030', themeJobId: 'theme-1', resultId: 'result-1', selectionRevision: 3 }
const draftKey = 'booth:artwork-request:user-1:theme-1:result-1:3'
const submitLabel = '确认费用，生成四面素材'
const retryLabel = '确认上次提交结果'
const themeJob = {
  jobId: 'theme-1', schemeCode: 'SC-6030', searchId: 'search-1', status: 'succeeded', phase: null, requestedCount: 1, usableCount: 1,
  original: { assetId: 'source', previewUrl: '/source.png' }, results: [{ resultId: 'result-1', previewUrl: '/theme-result.png', width: 1600, height: 900 }],
  selection: { resultId: 'result-1', revision: 3 }, credits: { status: 'settled', reservedCredits: 10, chargedCredits: 10, releasedCredits: 0 }, failure: null, pollAfterMs: null,
}
const offer = (id = 'offer-1', unitCredits = 5, ttlMs = 300_000) => ({ id, expiresAt: new Date(Date.now() + ttlMs).toISOString(), unitCredits, maxCredits: unitCredits * 4, settlementRule: 'per_usable_direction' })
const directions = ['front', 'back', 'left', 'right']
function artworkJob(ready = true, version = 0) {
  const done = ready ? directions : ['front', 'back']
  return {
    jobId: 'job-1', status: ready ? 'succeeded' : 'partially_succeeded', deliveryStatus: ready ? 'ready' : 'incomplete', reusedRequest: false,
    credits: { status: 'settled', reservedCredits: 20, heldCredits: 0, chargedCredits: done.length * 5, releasedCredits: (4 - done.length) * 5 }, pollAfterMs: null,
    schemeCode: 'SC-6030', phase: null, themeSelection: { themeJobId: 'theme-1', resultId: 'result-1', selectionRevision: 3 }, referencePreviewUrl: `/reference.png?v=${version}`,
    directions: directions.map(direction => done.includes(direction)
      ? { direction, status: 'succeeded', reason: null, assetId: `asset-${direction}`, width: 1536, height: 1024, byteSize: 100, filename: `${direction}.png`, previewUrl: `/${direction}.png?v=${version}` }
      : { direction, status: 'failed', reason: 'RESOLUTION_LOW' }),
    missingDirections: directions.filter(direction => !done.includes(direction)), mappingStatus: 'unresolved', quality: { minLongEdge: 1536, minShortEdge: 1024 },
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 5; i++) { await nextTick(); await sleep(5) } }

async function mount({ path = createPath, keepStorage = false, offers = [offer()], create = () => ({ jobId: 'job-1', status: 'queued', deliveryStatus: 'pending' }), job = () => artworkJob() } = {}) {
  if (!keepStorage) sessionStorage.clear()
  const calls = []
  let offerIndex = 0
  globalThis.__artwork = {
    auth: { isLoggedIn: true, currentUser: { id: 'user-1' } },
    apiFetch: async (url, options = {}) => {
      const method = options.method ?? 'GET'
      calls.push({ url, method, body: options.body ? JSON.parse(JSON.stringify(options.body)) : undefined })
      if (url === '/api/v1/client/theme-jobs/theme-1') return { code: 0, data: structuredClone(themeJob) }
      if (url === '/api/v1/client/artwork-jobs' && method === 'GET') return { code: 0, data: { items: [] } }
      if (url === '/api/v1/client/artwork-offers') return { code: 0, data: { offer: offers[Math.min(offerIndex++, offers.length - 1)] } }
      if (url === '/api/v1/client/artwork-jobs' && method === 'POST') return { code: 0, data: await create(options.body) }
      if (url === '/api/v1/client/artwork-jobs/job-1') return { code: 0, data: job() }
      if (url === '/api/v1/client/artwork-jobs/job-1/events-ticket') return { code: 0, data: { ticket: 'ticket' } }
      assert.fail(`Unexpected API: ${method} ${url}`)
    },
    raw: async url => {
      calls.push({ url, method: 'GET' })
      const type = url.endsWith('/download') && !url.includes('/assets/') ? 'application/zip' : 'image/png'
      return { _data: new Blob(['file'], { type }), headers: new Headers({ 'content-type': type }) }
    },
  }
  const router = createRouter({ history: createMemoryHistory(), routes: ['/schemes/:code/artwork', '/artwork-jobs/:jobId', '/:pathMatch(.*)*'].map(path => ({ path, component: { render: () => null } })) })
  await router.push(path)
  await router.isReady()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(ArtworkJob) })
  app.use(router)
  app.mount(container)
  await settle()
  return { container, router, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}
function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
async function click(container, text) { button(container, text).click(); await settle() }
const creations = mounted => mounted.calls.filter(call => call.url === '/api/v1/client/artwork-jobs' && call.method === 'POST')
const offerCalls = mounted => mounted.calls.filter(call => call.url === '/api/v1/client/artwork-offers')
const alertText = mounted => mounted.container.querySelector('[role="alert"]')?.textContent ?? ''
function rejection(status, reason) { return Object.assign(new Error('rejected'), { response: { status }, data: { error: reason ? { reason } : {} } }) }

test('create view fixes the selected theme, shows the offer and submits it once before opening the job view', async () => {
  const mounted = await mount()
  try {
    assert.equal(mounted.container.querySelector('aside img').getAttribute('src'), '/theme-result.png')
    assert.match(mounted.container.textContent, /20 积分/)
    await click(mounted.container, submitLabel)
    assert.equal(creations(mounted).length, 1)
    const body = creations(mounted)[0].body
    assert.deepEqual({ ...body, requestKey: undefined }, { ...context, offerId: 'offer-1', requestKey: undefined })
    assert.match(body.requestKey, /^[0-9a-f-]{36}$/i)
    assert.equal(mounted.router.currentRoute.value.path, '/artwork-jobs/job-1')
    assert.equal(sessionStorage.getItem(draftKey), null)
    assert.match(mounted.container.textContent, /四面齐全，已通过像素与格式验收/)
  } finally { await mounted.close() }
})

test('a lost receipt keeps the request and a reload retries it with the same request key without a new offer', async () => {
  let mounted = await mount({ create: () => { throw new Error('Connection lost') } })
  let first
  try {
    await click(mounted.container, submitLabel)
    first = creations(mounted)[0].body
    assert.match(alertText(mounted), /暂未确认提交结果/)
    assert.deepEqual(JSON.parse(sessionStorage.getItem(draftKey)), first)
  } finally { await mounted.close() }
  mounted = await mount({ keepStorage: true })
  try {
    assert.equal(offerCalls(mounted).length, 0)
    await click(mounted.container, retryLabel)
    assert.deepEqual(creations(mounted)[0].body, first)
    assert.equal(mounted.router.currentRoute.value.path, '/artwork-jobs/job-1')
    assert.equal(sessionStorage.getItem(draftKey), null)
  } finally { await mounted.close() }
})

test('storage that rejects writes and deletes neither blocks the first submission nor the navigation after success', async () => {
  const { setItem, removeItem } = Storage.prototype
  const mounted = await mount()
  Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
  Storage.prototype.removeItem = () => { throw new Error('SecurityError') }
  try {
    await click(mounted.container, submitLabel)
    assert.equal(creations(mounted).length, 1)
    assert.equal(mounted.router.currentRoute.value.path, '/artwork-jobs/job-1')
    assert.doesNotMatch(alertText(mounted), /暂未确认提交结果/)
  } finally {
    Storage.prototype.setItem = setItem
    Storage.prototype.removeItem = removeItem
    await mounted.close()
  }
})

test('an offer about to expire is renewed before submitting and an unchanged price submits directly', async () => {
  const mounted = await mount({ offers: [offer('offer-old', 5, 5_000), offer('offer-new', 5)] })
  try {
    await click(mounted.container, submitLabel)
    assert.equal(offerCalls(mounted).length, 2)
    assert.equal(creations(mounted).length, 1)
    assert.equal(creations(mounted)[0].body.offerId, 'offer-new')
  } finally { await mounted.close() }
})

test('a renewed offer with a different price is shown and needs another confirmation', async () => {
  const mounted = await mount({ offers: [offer('offer-old', 5, 5_000), offer('offer-new', 6)] })
  try {
    await click(mounted.container, submitLabel)
    assert.equal(creations(mounted).length, 0)
    assert.match(alertText(mounted), /费用报价已更新/)
    assert.match(mounted.container.textContent, /24 积分/)
    await click(mounted.container, submitLabel)
    assert.equal(creations(mounted).length, 1)
    assert.equal(creations(mounted)[0].body.offerId, 'offer-new')
  } finally { await mounted.close() }
})

test('an OFFER_EXPIRED rejection drops the request key and offers a renewed quote for explicit confirmation', async () => {
  let attempts = 0
  const mounted = await mount({ offers: [offer('offer-1'), offer('offer-2')], create: () => { if (++attempts === 1) throw rejection(409, 'OFFER_EXPIRED'); return { jobId: 'job-1' } } })
  try {
    await click(mounted.container, submitLabel)
    assert.match(alertText(mounted), /原报价已过期，已获取最新报价/)
    assert.equal(sessionStorage.getItem(draftKey), null)
    assert.equal(creations(mounted).length, 1)
    await click(mounted.container, submitLabel)
    const [first, second] = creations(mounted).map(call => call.body)
    assert.notEqual(second.requestKey, first.requestKey)
    assert.equal(second.offerId, 'offer-2')
  } finally { await mounted.close() }
})

for (const [status, reason, message] of [[402, undefined, /可用积分不足/], [409, 'MODEL_UNAVAILABLE', /四面素材生成服务暂不可用/], [409, 'OFFER_STALE', /主题选择或费用已变化/]]) {
  test(`a ${status} ${reason ?? ''} rejection explains the cause and does not keep the request key`, async () => {
    const mounted = await mount({ create: () => { throw rejection(status, reason) } })
    try {
      await click(mounted.container, submitLabel)
      assert.match(alertText(mounted), message)
      assert.equal(sessionStorage.getItem(draftKey), null)
      assert.equal(button(mounted.container, submitLabel).disabled, true)
    } finally { await mounted.close() }
  })
}

test('a partially delivered job lists the missing directions and offers no ZIP or quote', async () => {
  const mounted = await mount({ path: '/artwork-jobs/job-1', job: () => artworkJob(false) })
  try {
    assert.match(mounted.container.textContent, /本次成果尚未成套/)
    assert.match(mounted.container.textContent, /缺少：左侧、右侧/)
    assert.equal([...mounted.container.querySelectorAll('button')].some(element => element.textContent.trim() === '下载完整四面 ZIP'), false)
    assert.equal(mounted.container.querySelectorAll('img[alt$="方向底图"]').length, 2)
  } finally { await mounted.close() }
})

test('a complete job downloads single directions and the ZIP and links the quote to the fixed theme', async () => {
  downloads.length = 0
  const mounted = await mount({ path: '/artwork-jobs/job-1' })
  try {
    const single = [...mounted.container.querySelectorAll('button')].filter(element => element.textContent.trim() === '单张')
    assert.equal(single.length, 4)
    single[0].click(); await settle()
    await click(mounted.container, '下载完整四面 ZIP')
    assert.deepEqual(mounted.calls.filter(call => call.url.includes('download')).map(call => call.url), ['/api/v1/client/artwork-jobs/job-1/assets/asset-front/download', '/api/v1/client/artwork-jobs/job-1/download'])
    assert.equal(downloads.length, 2)
    assert.equal(downloads[0], 'front.png')
    assert.match(downloads[1], /\.zip$/)
    const quote = [...mounted.container.querySelectorAll('a')].find(element => element.textContent.includes('携带素材申请报价'))
    assert.ok(quote)
    assert.equal(quote.getAttribute('href'), '/schemes/SC-6030/quote?themeJobId=theme-1&artworkJobId=job-1')
  } finally { await mounted.close() }
})

test('an expired direction link is re-signed by re-reading the job', async () => {
  let version = 0
  const mounted = await mount({ path: '/artwork-jobs/job-1', job: () => artworkJob(true, version) })
  const realNow = Date.now
  try {
    const reads = () => mounted.calls.filter(call => call.url === '/api/v1/client/artwork-jobs/job-1').length
    const before = reads()
    Date.now = () => realNow() + 60_000
    version = 1
    mounted.container.querySelector('img[alt$="方向底图"]').dispatchEvent(new Event('error'))
    await settle()
    assert.equal(reads(), before + 1)
    assert.equal(mounted.container.querySelector('img[alt$="方向底图"]').getAttribute('src'), '/front.png?v=1')
  } finally { Date.now = realNow; await mounted.close() }
})
