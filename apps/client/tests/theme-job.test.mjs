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
    name: 'test-theme-job', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/features/selection/SelectionShell.vue') || path.endsWith('/layouts/MainLayout.vue')) return '\0test-shell'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__themeJob.apiFetch(...args)"
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
class ControlledEventSource {
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; globalThis.__themeJob.streams.push(this) }
  addEventListener(name, callback) { this.listeners[name] = callback }
  close() { this.closed = true }
  update() { this.listeners.update?.() }
}
globalThis.EventSource = ControlledEventSource
after(async () => {
  globalThis.EventSource = originalEventSource
  delete globalThis.__themeJob
  await server.close()
  await window.happyDOM.close()
})
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: ThemeJob } = await server.ssrLoadModule('/src/pages/ThemeJob.vue')
const jobId = '12345678-1234-1234-1234-123456789012'
const endpoint = `/api/v1/client/theme-jobs/${jobId}`
const quoteLabel = '使用已选定效果申请报价'
const artworkLabel = '使用已选定效果生成四面素材'
function job(overrides = {}) {
  return {
    jobId, schemeCode: 'SC-6030', searchId: 'search-42', status: 'succeeded', phase: null,
    requestedCount: 3, usableCount: 3, original: { assetId: 'original', previewUrl: '/original.jpg' },
    results: [1, 2, 3].map(number => ({ resultId: `result-${number}`, previewUrl: `/result-${number}.jpg`, width: 1600, height: 900 })),
    selection: { resultId: null, revision: 0 },
    credits: { status: 'settled', reservedCredits: 30, chargedCredits: 30, releasedCredits: 0 },
    failure: null, pollAfterMs: null, ...overrides,
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await sleep(5) } }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function conflict() { return Object.assign(new Error('SELECTION_CONFLICT'), { response: { status: 409 } }) }
async function mount({ get = () => job(), save = body => ({ resultId: body.resultId, revision: body.expectedRevision + 1 }) } = {}) {
  const calls = [], streams = []
  globalThis.__themeJob = {
    streams,
    apiFetch: async (path, options) => {
      calls.push({ path, method: options?.method ?? 'GET', body: options?.body })
      let data
      if (path === endpoint) data = await get()
      else if (path === `${endpoint}/selection`) data = await save(options.body)
      else if (path === `${endpoint}/events-ticket`) data = { ticket: 'test-ticket' }
      else assert.fail(`Unexpected API: ${path}`)
      return { code: 0, data: structuredClone(data) }
    },
  }
  const router = createRouter({ history: createMemoryHistory(), routes: ['/theme-jobs/:jobId', '/:pathMatch(.*)*'].map(path => ({ path, component: { render: () => null } })) })
  await router.push(`/theme-jobs/${jobId}`)
  await router.isReady()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(ThemeJob) })
  app.use(router)
  app.mount(container)
  await settle()
  return { container, router, calls, streams, close: async () => { app.unmount(); container.remove(); await settle() } }
}
function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}
async function preview(mounted, number) {
  const target = mounted.container.querySelector(`[aria-label^="预览第 ${number} 张"]`)
  assert.ok(target)
  target.click()
  await settle()
  assert.equal(target.getAttribute('aria-pressed'), 'true')
}
function aside(mounted) { return mounted.container.querySelector('aside') }
function saves(mounted) { return mounted.calls.filter(call => call.method === 'PUT') }

test('thumbnail browsing only changes preview; unselected state emphasizes selection and hides long task ID in details', async () => {
  const mounted = await mount()
  try {
    assert.match(mounted.container.querySelector('header').textContent, /方案 SC-6030.*AI 换主题结果.*生成完成/s)
    const details = mounted.container.querySelector('header details')
    assert.equal(details.open, false)
    assert.match(details.textContent, new RegExp(jobId))
    const thumbnails = mounted.container.querySelectorAll('[aria-label="切换效果预览"] button')
    assert.equal(thumbnails.length, 3)
    assert.ok([...thumbnails].every(element => element.querySelector('img')))
    await preview(mounted, 2)
    assert.match(mounted.container.querySelector('#preview-heading').textContent, /正在预览第 2 张/)
    assert.equal(mounted.container.querySelector('img[alt="正在预览的第 2 张主题效果"]').getAttribute('src'), '/result-2.jpg')
    assert.equal(saves(mounted).length, 0)
    assert.match(aside(mounted).textContent, /尚未选定效果/)
    assert.equal(button(mounted.container, quoteLabel).disabled, true)
    assert.equal(button(mounted.container, artworkLabel).disabled, true)
    assert.equal(button(mounted.container, '选用此效果').disabled, false)
    assert.equal(mounted.container.querySelector('a[href="/schemes/SC-6030?searchId=search-42"]').textContent.trim(), '继续使用原方案')
  } finally { await mounted.close() }
})

test('restored selection stays distinct from preview and both downstream routes carry the saved task context', async () => {
  const mounted = await mount({ get: () => job({ selection: { resultId: 'result-2', revision: 4 } }) })
  try {
    await preview(mounted, 3)
    assert.equal(aside(mounted).querySelector('img').getAttribute('src'), '/result-2.jpg')
    assert.match(aside(mounted).textContent, /正在预览第 3 张，后续仍使用已选定的第 2 张/)
    button(mounted.container, quoteLabel).click()
    await settle()
    assert.equal(mounted.router.currentRoute.value.path, '/schemes/SC-6030/quote')
    assert.deepEqual(mounted.router.currentRoute.value.query, { themeJobId: jobId })
    button(mounted.container, artworkLabel).click()
    await settle()
    assert.equal(mounted.router.currentRoute.value.path, '/schemes/SC-6030/artwork')
    assert.deepEqual(mounted.router.currentRoute.value.query, { themeJobId: jobId })
    button(mounted.container, '预览已选定效果').click()
    await settle()
    assert.match(mounted.container.querySelector('#preview-heading').textContent, /正在预览第 2 张/)
    assert.match(mounted.container.textContent, /此效果已选定/)
    assert.equal(saves(mounted).length, 0)
  } finally { await mounted.close() }
})

test('save uses clicked result and revision, blocks duplicate save and continuation, and survives preview changes while waiting', async () => {
  const pending = deferred()
  const mounted = await mount({ get: () => job({ selection: { resultId: 'result-1', revision: 7 } }), save: () => pending.promise })
  try {
    await preview(mounted, 2)
    const select = button(mounted.container, '选用此效果')
    select.click()
    select.click()
    await settle()
    assert.deepEqual(saves(mounted), [{ path: `${endpoint}/selection`, method: 'PUT', body: { resultId: 'result-2', expectedRevision: 7 } }])
    assert.equal(button(mounted.container, quoteLabel).disabled, true)
    assert.equal(button(mounted.container, artworkLabel).disabled, true)
    await preview(mounted, 3)
    assert.equal(button(mounted.container, '正在保存第 2 张…').disabled, true)
    pending.resolve({ resultId: 'result-2', revision: 8 })
    await settle()
    assert.match(mounted.container.querySelector('#preview-heading').textContent, /正在预览第 3 张/)
    assert.equal(aside(mounted).querySelector('img').getAttribute('src'), '/result-2.jpg')
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /选择已保存.*当前已选定第 2 张/)
    assert.equal(button(mounted.container, quoteLabel).disabled, false)
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.deepEqual(saves(mounted).at(-1).body, { resultId: 'result-3', expectedRevision: 8 })
  } finally { pending.resolve({ resultId: 'result-2', revision: 8 }); await mounted.close() }
})

test('save failure preserves preview, requires refresh and recognizes a save that reached the server', async () => {
  let reads = 0
  const mounted = await mount({
    get: () => job({ selection: ++reads === 1 ? { resultId: 'result-1', revision: 1 } : { resultId: 'result-2', revision: 2 } }),
    save: () => { throw new Error('network timeout') },
  })
  try {
    await preview(mounted, 2)
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /保存选定效果失败.*无法确认是否保存成功/)
    assert.match(aside(mounted).textContent, /选定状态待确认/)
    assertNoNode(aside(mounted).querySelector('img'), "aside(mounted).querySelector('img')")
    assert.equal(button(mounted.container, quoteLabel).disabled, true)
    assert.equal(button(mounted.container, '选用此效果').disabled, true)
    assert.match(mounted.container.querySelector('#preview-heading').textContent, /正在预览第 2 张/)
    button(mounted.container, '刷新选定状态').click()
    await settle()
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /已刷新选定状态.*当前已选定第 2 张/)
    assert.equal(button(mounted.container, quoteLabel).disabled, false)
    assert.equal(saves(mounted).length, 1)
  } finally { await mounted.close() }
})

test('409 refresh explains the latest selection without changing preview or overwriting it; retry uses fresh revision', async () => {
  let reads = 0, writes = 0
  const mounted = await mount({
    get: () => job({ selection: ++reads === 1 ? { resultId: 'result-1', revision: 1 } : { resultId: 'result-3', revision: 5 } }),
    save: body => { if (++writes === 1) throw conflict(); return { resultId: body.resultId, revision: 6 } },
  })
  try {
    await preview(mounted, 2)
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /本次选择未覆盖最新状态.*当前已选定第 3 张/)
    assert.match(mounted.container.querySelector('#preview-heading').textContent, /正在预览第 2 张/)
    assert.equal(aside(mounted).querySelector('img').getAttribute('src'), '/result-3.jpg')
    assert.equal(writes, 1)
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.deepEqual(saves(mounted).at(-1).body, { resultId: 'result-2', expectedRevision: 5 })
    assert.equal(aside(mounted).querySelector('img').getAttribute('src'), '/result-2.jpg')
  } finally { await mounted.close() }
})

test('failed conflict refresh remains visible and blocks actions until a successful refresh, including no-selection state', async () => {
  let reads = 0
  const retry = deferred()
  const mounted = await mount({
    get: () => { reads++; if (reads === 2) throw new Error('offline'); return reads === 3 ? retry.promise : job() },
    save: () => { throw conflict() },
  })
  try {
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /选定状态已发生变化，刷新失败/)
    assert.equal(button(mounted.container, quoteLabel).disabled, true)
    button(mounted.container, '刷新选定状态').click()
    await settle()
    assert.equal(button(mounted.container, '正在刷新…').disabled, true)
    assert.equal(button(mounted.container, '选用此效果').disabled, true)
    retry.resolve(job({ selection: { resultId: null, revision: 4 } }))
    await settle()
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /当前尚未选定效果/)
    assert.equal(button(mounted.container, '选用此效果').disabled, false)
    assert.equal(button(mounted.container, quoteLabel).disabled, true)
  } finally { retry.resolve(job()); await mounted.close() }
})

test('conflict that changes task status still explains why selection is unavailable', async () => {
  let reads = 0
  const mounted = await mount({ get: () => ++reads === 1 ? job() : job({ status: 'failed', results: [] }), save: () => { throw conflict() } })
  try {
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /任务当前不可选用效果/)
    assertNoNode(mounted.container.querySelector('aside'), "mounted.container.querySelector('aside')")
  } finally { await mounted.close() }
})

test('initial load failure can retry successfully and shows explicit loading feedback', async () => {
  let reads = 0
  const retry = deferred()
  const mounted = await mount({ get: () => { if (++reads === 1) throw new Error('offline'); return retry.promise } })
  try {
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /任务加载失败/)
    button(mounted.container, '重新加载任务').click()
    await settle()
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /正在加载任务/)
    retry.resolve(job())
    await settle()
    assertNoNode(mounted.container.querySelector('[role="alert"]'), "mounted.container.querySelector('[role=\"alert\"]')")
    assert.match(mounted.container.textContent, /正在预览第 1 张/)
  } finally { retry.resolve(job()); await mounted.close() }
})

test('pending task receives SSE updates, closes stream on partial completion and allows selection of usable results', async () => {
  let reads = 0
  const mounted = await mount({ get: () => ++reads === 1 ? job({ status: 'running', results: [] }) : job({ status: 'partially_succeeded', results: job().results.slice(0, 1), usableCount: 1 }) })
  try {
    assert.match(mounted.container.textContent, /AI 正在生成/)
    assert.equal(mounted.streams.length, 1)
    assert.equal(mounted.streams[0].url, `${endpoint}/events?ticket=test-ticket`)
    mounted.streams[0].update()
    await settle()
    assert.equal(mounted.streams[0].closed, true)
    assert.match(mounted.container.textContent, /已成功生成 1 \/ 3 张/)
    button(mounted.container, '选用此效果').click()
    await settle()
    assert.equal(button(mounted.container, artworkLabel).disabled, false)
  } finally { await mounted.close() }
})

test('pending task falls back to polling when SSE stays silent and stops polling once finished', async () => {
  const realSetTimeout = globalThis.setTimeout
  const fallbacks = []
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 10_000) return realSetTimeout(callback, delay, ...args)
    fallbacks.push(callback)
    return realSetTimeout(() => {}, 0)
  }
  let reads = 0
  let mounted
  try {
    mounted = await mount({ get: () => ++reads < 3 ? job({ status: 'running', results: [] }) : job() })
    assert.equal(mounted.streams.length, 1)
    assert.equal(fallbacks.length, 1)
    fallbacks[0]()
    await settle()
    assert.equal(reads, 2)
    assert.match(mounted.container.textContent, /AI 正在生成/)
    assert.equal(fallbacks.length, 2)
    fallbacks[1]()
    await settle()
    assert.equal(reads, 3)
    assert.equal(mounted.streams[0].closed, true)
    assert.match(mounted.container.textContent, /生成完成/)
    assert.equal(fallbacks.length, 2)
  } finally {
    globalThis.setTimeout = realSetTimeout
    await mounted?.close()
  }
})

test('missing selected result cannot enable downstream actions; completed empty results provide a recovery action', async () => {
  const mounted = await mount({ get: () => job({ selection: { resultId: 'missing', revision: 2 } }) })
  try {
    assert.match(aside(mounted).textContent, /已选定效果不可用/)
    assert.equal(button(mounted.container, quoteLabel).disabled, true)
    assert.equal(button(mounted.container, '选用此效果').disabled, false)
  } finally { await mounted.close() }
  const empty = await mount({ get: () => job({ results: [] }) })
  try {
    assert.match(empty.container.textContent, /暂无可预览的效果图/)
    assert.ok(button(empty.container, '重新加载任务'))
  } finally { await empty.close() }
})
