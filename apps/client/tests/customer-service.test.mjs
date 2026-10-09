import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { assertNoNode } from './dom-assert.mjs'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'localStorage', 'sessionStorage', 'Storage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
window.localStorage.setItem('app-locale', 'zh')

// EventSource 替身：记录 URL，测试通过 emit 推送事件
class FakeEventSource {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; FakeEventSource.instances.push(this) }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener) }
  emit(type, data) { for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) }) }
  close() { this.closed = true }
}
globalThis.EventSource = FakeEventSource

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
    name: 'test-customer-service', enforce: 'pre',
    resolveId(id) {
      const path = id.replaceAll('\\', '/').replace(/\.ts$/, '')
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (path.endsWith('/lib/api-client')) return '\0test-api'
      if (path.endsWith('/stores/auth')) return '\0test-auth'
      if (path.endsWith('/components/ui/sheet') || path.endsWith('/components/ui/sheet/index')) return '\0test-sheet'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__cs.apiFetch(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__cs.auth'
      // Sheet 替身：打开时直接渲染内容，保留 dir 等属性
      if (id === '\0test-sheet') return `import { h } from 'vue'
        const pass = tag => ({ inheritAttrs: false, setup(_, { slots, attrs }) { return () => h(tag, attrs, slots.default?.()) } })
        export const Sheet = { props: ['open'], setup(props, { slots }) { return () => (props.open ? h('div', { 'data-sheet': '' }, slots.default?.()) : null) } }
        export const SheetContent = pass('section'); export const SheetHeader = pass('header'); export const SheetTitle = pass('h2'); export const SheetDescription = pass('p')`
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
// 断开最后一条连接：否则看门狗与重连定时器会让进程一直存活
after(async () => { cs.resetCustomerService(); delete globalThis.__cs;delete globalThis.EventSource; await server.close(); await window.happyDOM.close() })
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: ChatLauncher } = await server.ssrLoadModule('/src/features/customer-service/ChatLauncher.vue')
const timeline = await server.ssrLoadModule('/src/features/customer-service/timeline.ts')
const cs = await server.ssrLoadModule('/src/features/customer-service/useCustomerService.ts')
const { STALE_MS } = await server.ssrLoadModule('/src/features/customer-service/useCustomerServiceConnection.ts')
const { appLocale } = await server.ssrLoadModule('/src/plugins/i18n/index.ts')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function settle() { for (let i = 0; i < 6; i++) { await nextTick(); await sleep(5) } }
const conversationId = '11111111-1111-4111-8111-111111111111'
const conversation = (overrides = {}) => ({ id: conversationId, conversationNo: 'CS-00000001', status: 'queued', agent: null, contactEmail: null,
  hasOfflineMessage: false, lastPublicSeq: null, customerReadSeq: 0, agentReadSeq: 0, createdAt: '2026-10-08T00:00:00Z', closedAt: null, ...overrides })
const message = (seq, overrides = {}) => ({ id: `m${seq}`, seq, conversationId, conversationNo: 'CS-00000001', senderType: 'customer', senderName: null,
  kind: 'text', body: `body ${seq}`, locale: 'zh', context: null, eventCode: null, eventParams: null, translation: null, clientMessageId: null,
  createdAt: '2026-10-08T00:00:00Z', ...overrides })
const failure = (status, reason) => Object.assign(new Error(reason), { response: { status }, data: { error: { reason } } })

function setup({ loggedIn = false, agentsOnline = true, current = conversation(), messages = [], respond } = {}) {
  const calls = []
  let issued = 0
  globalThis.__cs = {
    auth: { isLoggedIn: loggedIn, currentUser: loggedIn ? { email: 'buyer@example.com' } : null },
    apiFetch: async (path, options = {}) => {
      const call = { path, method: options.method ?? 'GET', body: options.body, query: options.query, headers: options.headers }
      calls.push(call)
      const custom = await respond?.(call, calls)
      if (custom !== undefined) return { code: 0, data: custom }
      if (path.endsWith('/visitors')) return { code: 0, data: { visitorId: `v${++issued}` } }
      if (path.endsWith('/visitors/merge')) return { code: 0, data: { mergedConversations: 1 } }
      if (path.endsWith('/conversations')) return { code: 0, data: { conversation: current, contexts: [], agentsOnline } }
      if (path.endsWith('/conversations/current')) return { code: 0, data: { conversation: current, contexts: [], unreadCount: 0, agentsOnline } }
      if (path.endsWith('/messages') && call.method === 'GET') return { code: 0, data: { items: messages, hasMore: false } }
      if (path.endsWith('/events-ticket')) return { code: 0, data: { ticket: 'ticket-1' } }
      if (path.endsWith('/read')) return { code: 0, data: { customerReadSeq: options.body.seq } }
      if (path.endsWith('/messages')) return { code: 0, data: { message: message(99, { body: options.body.body, clientMessageId: options.body.clientMessageId }), conversation: current } }
      throw new Error(`Unexpected ${path}`)
    },
  }
  return calls
}

async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  const container = document.createElement('div'); document.body.append(container)
  const app = createApp({ render: () => h(ChatLauncher) }); app.use(router); app.mount(container)
  await settle()
  return { container, router, unmount: () => { app.unmount(); container.remove() } }
}

beforeEach(() => {
  cs.resetCustomerService()
  cs.setPageContext(null)
  localStorage.removeItem('booth-ai:cs-visitor')
  FakeEventSource.instances = []
  appLocale.value = 'zh'
})

test('timeline merges by id, splits rounds, prefers translations and counts unread agent messages', () => {
  const merged = timeline.mergeMessages([message(3), message(1)], [message(2), message(3, { body: 'updated' })])
  assert.deepEqual(merged.map(item => item.seq), [1, 2, 3])
  assert.equal(merged[2].body, 'updated')
  const rounds = timeline.splitRounds([message(1), message(2, { conversationId: 'c2', conversationNo: 'CS-00000002' }), message(3, { conversationId: 'c2', conversationNo: 'CS-00000002' })])
  assert.deepEqual(rounds.map(round => [round.conversationNo, round.messages.length]), [['CS-00000001', 1], ['CS-00000002', 2]])
  const agent = message(4, { senderType: 'agent', body: '你好', translation: { locale: 'en', status: 'done', body: 'Hello' } })
  assert.deepEqual(timeline.displayBody(agent, false), { body: 'Hello', status: 'translated' })
  assert.deepEqual(timeline.displayBody(agent, true), { body: '你好', status: 'original' })
  assert.deepEqual(timeline.displayBody({ ...agent, translation: { locale: 'en', status: 'pending', body: null } }, false), { body: '你好', status: 'pending' })
  assert.deepEqual(timeline.displayBody({ ...agent, translation: { locale: 'en', status: 'failed', body: null } }, false), { body: '你好', status: 'failed' })
  assert.deepEqual(timeline.displayBody(message(5, { translation: { locale: 'zh', status: 'done', body: 'x' } }), false), { body: 'body 5', status: 'original' })
  const unread = [agent, message(6, { senderType: 'agent' }), message(7)]
  assert.equal(timeline.unreadCount(unread, new Map([[conversationId, 4]])), 1)
  assert.deepEqual([...timeline.readTargets(unread)], [[conversationId, 6]])
})

test('visitors are lazily issued (token stays in an HttpOnly cookie), open with context, subscribe after the last seq and fall back when the context is unavailable', async () => {
  const calls = setup({
    messages: [message(1), message(2, { senderType: 'agent' })],
    respond: call => {
      if (call.path.endsWith('/conversations') && call.body.context) throw failure(404, 'CONTEXT_NOT_FOUND')
    },
  })
  const { unmount, container } = await mount()
  await cs.openWith({ kind: 'project', projectId: 'p-1' }, 'quote_receipt')
  await settle()
  assert.equal(localStorage.getItem('booth-ai:cs-visitor'), '1', 'only a non-secret marker is stored locally')
  const opens = calls.filter(call => call.path.endsWith('/conversations'))
  assert.deepEqual(opens.map(call => call.body), [{ entryPoint: 'quote_receipt', context: { kind: 'project', projectId: 'p-1' } }, { entryPoint: 'quote_receipt' }])
  assert.equal(calls.filter(call => call.path.endsWith('/visitors')).length, 1, 'concurrent calls share one issue request')
  assert.match(container.textContent, /无法附带该方案或项目/)
  assert.equal(FakeEventSource.instances.length, 1)
  assert.match(FakeEventSource.instances[0].url, /\/conversations\/11111111-1111-4111-8111-111111111111\/events\?ticket=ticket-1&after=2$/)
  assert.deepEqual(calls.filter(call => call.path.endsWith('/read')).map(call => call.body), [{ seq: 2 }])
  assertNoNode(container.querySelector('[data-cs-offline]'), 'agents online: chat composer instead of the offline form')
  assert.match(container.querySelector('[data-cs-status]').textContent, /排队中/)
  unmount()
})

test('an invalidated visitor (merged, deleted or cookie lost) is reissued and the request retried once', async () => {
  localStorage.setItem('booth-ai:cs-visitor', '1')
  let rejected = false
  const calls = setup({ respond: call => {
    if (call.path.endsWith('/conversations') && !rejected) { rejected = true; throw failure(401, 'VISITOR_REQUIRED') }
  } })
  await cs.openWith(undefined, 'floating')
  assert.equal(localStorage.getItem('booth-ai:cs-visitor'), '1')
  assert.equal(calls.filter(call => call.path.endsWith('/visitors')).length, 1, 'the marker skipped issuing until the server rejected the visitor')
  assert.equal(calls.filter(call => call.path.endsWith('/conversations')).length, 2)
  assert.equal(cs.useCustomerService().state.notice, '')
})

test('login merges the cookie-held visitor once and clears the marker; without a marker nothing is merged', async () => {
  localStorage.setItem('booth-ai:cs-visitor', '1')
  const calls = setup({ loggedIn: true })
  await cs.handleCustomerServiceLogin()
  const merges = calls.filter(call => call.path.endsWith('/visitors/merge'))
  assert.deepEqual(merges.map(call => [call.method, call.body, call.headers]), [['POST', undefined, undefined]], 'the token is never sent from script')
  assert.equal(localStorage.getItem('booth-ai:cs-visitor'), null)
  await cs.handleCustomerServiceLogin()
  assert.equal(calls.filter(call => call.path.endsWith('/visitors/merge')).length, 1)
})

test('offline mode replaces the composer, requires a visitor email and sends an offline message', async () => {
  const calls = setup({ agentsOnline: false })
  const { unmount, container } = await mount()
  container.querySelector('[data-cs-launcher]').click()
  await settle()
  const form = container.querySelector('[data-cs-offline]')
  assert.equal(Boolean(form), true)
  assert.match(form.textContent, /客服暂不在线，留言后将通过邮件回复/)
  const textarea = form.querySelector('textarea')
  textarea.value = '请联系我'; textarea.dispatchEvent(new Event('input'))
  await settle()
  form.dispatchEvent(new Event('submit'))
  await settle()
  assert.match(form.textContent, /请输入有效的邮箱/)
  assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/messages')).length, 0)
  const email = form.querySelector('input')
  email.value = 'Buyer@Example.com'; email.dispatchEvent(new Event('input'))
  await settle()
  form.dispatchEvent(new Event('submit'))
  await settle()
  const sent = calls.find(call => call.method === 'POST' && call.path.endsWith('/messages'))
  assert.deepEqual({ ...sent.body, clientMessageId: typeof sent.body.clientMessageId }, { body: '请联系我', kind: 'offline', contactEmail: 'Buyer@Example.com', clientMessageId: 'string' })
  unmount()
})

test('messages render as plain text, agent replies show translations, events and RTL layout', async () => {
  setup({ current: conversation({ status: 'active', agent: { displayName: null } }), messages: [
    message(1, { body: '<b>bold</b><img src=x onerror=alert(1)>' }),
    message(2, { senderType: 'system', kind: 'event', eventCode: 'claimed', eventParams: { agentName: null } }),
    message(3, { senderType: 'agent', body: '您好', translation: { locale: 'en', status: 'pending', body: null } }),
  ] })
  appLocale.value = 'ar'
  const { unmount, container } = await mount()
  await cs.openWith(undefined, 'floating')
  await settle()
  const panel = container.querySelector('[data-cs-panel]')
  assert.equal(panel.getAttribute('dir'), 'rtl')
  assertNoNode(container.querySelector('[data-cs-panel] b'), 'message HTML is not parsed')
  assertNoNode(container.querySelector('[data-cs-panel] img'), 'message HTML is not parsed')
  assert.match(panel.textContent, /<b>bold<\/b>/)
  assert.match(panel.textContent, /客服 已接入/)
  assert.match(panel.textContent, /翻译中/)
  assert.match(container.querySelector('[data-cs-status]').textContent, /客服 客服 已接入/)

  FakeEventSource.instances[0].emit('update', { type: 'message.translated', messageId: 'm3', seq: 3, translation: { locale: 'en', status: 'done', body: 'Hello' } })
  await settle()
  assert.match(panel.textContent, /Hello/)
  assert.match(panel.textContent, /查看原文/)
  FakeEventSource.instances[0].emit('update', { type: 'conversation.updated', conversation: conversation({ status: 'closed', closedAt: '2026-10-08T01:00:00Z' }) })
  await settle()
  assert.match(container.querySelector('[data-cs-status]').textContent, /本次会话已结束/)
  unmount()
})

test('sending is idempotent on retry, starts a new round after the conversation closed and disconnects when the panel closes', async () => {
  let failOnce = true
  const calls = setup({ respond: call => {
    if (call.method === 'POST' && call.path.endsWith('/messages') && failOnce) { failOnce = false; throw failure(500, 'INTERNAL') }
  } })
  const { unmount, container } = await mount()
  await cs.openWith(undefined, 'floating')
  await settle()
  const { state, send, retry, closePanel } = cs.useCustomerService()
  assert.equal(await send('  第一条  '), false)
  await settle()
  assert.match(container.querySelector('[data-cs-pending]').textContent, /发送失败/)
  const pending = state.pending[0]
  assert.equal(await retry(pending.clientMessageId), true)
  const posts = calls.filter(call => call.method === 'POST' && call.path.endsWith('/messages'))
  assert.deepEqual(posts.map(call => [call.body.body, call.body.clientMessageId]), [['第一条', pending.clientMessageId], ['第一条', pending.clientMessageId]])
  assert.equal(state.pending.length, 0)

  state.conversation = { ...state.conversation, status: 'closed' }
  await send('新一轮')
  assert.equal(calls.filter(call => call.path.endsWith('/conversations')).length, 2, 'a closed round is reopened before sending')

  closePanel()
  await settle()
  assert.equal(FakeEventSource.instances.every(source => source.closed), true, 'closing the panel disconnects the stream')
  unmount()
})

test('a stream silent for 45 seconds is dropped and reconnected; pings keep it alive', async t => {
  setup()
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)) }
  await cs.openWith(undefined, 'floating')
  await flush()
  const { state, closePanel } = cs.useCustomerService()
  const [first] = FakeEventSource.instances
  assert.equal(FakeEventSource.instances.length, 1)
  first.emit('open')
  assert.equal(state.connection, 'live')
  t.mock.timers.tick(STALE_MS - 1)
  first.emit('ping', {})
  t.mock.timers.tick(STALE_MS - 1)
  assert.equal(first.closed, false, 'a ping resets the watchdog')
  t.mock.timers.tick(1)
  // 代理吞掉上游断开时浏览器收不到 error，只能靠看门狗发现
  assert.equal(first.closed, true)
  assert.equal(state.connection, 'polling')
  t.mock.timers.tick(3000)
  await flush()
  assert.equal(FakeEventSource.instances.length, 2, 'reconnects after the first backoff')
  closePanel()
})

test('translations finished while disconnected are recalibrated on reconnect and on reopening', async t => {
  const pending = { locale: 'en', status: 'pending', body: null }
  let items = [message(1), message(2, { senderType: 'agent', body: '稍等', translation: { locale: 'en', status: 'done', body: 'Wait' } }),
    message(3, { senderType: 'agent', body: '您好', translation: pending }), message(4)]
  const calls = setup({ current: conversation({ status: 'active' }), respond: call => (call.path.endsWith('/messages') && call.method === 'GET'
    ? { items: items.filter(item => call.query.after === undefined || item.seq > call.query.after), hasMore: false } : undefined) })
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)) }
  await cs.openWith(undefined, 'floating')
  await flush()
  const { state, closePanel } = cs.useCustomerService()
  const translation = id => state.messages.find(item => item.id === id).translation
  FakeEventSource.instances[0].emit('open')
  await flush()
  assert.equal(translation('m3').status, 'pending')

  // 断线期间翻译完成：SSE 按 seq 补发拿不到，重连后必须重取
  FakeEventSource.instances[0].onerror()
  items = items.map(item => (item.seq === 3 ? { ...item, translation: { locale: 'en', status: 'done', body: 'Hello' } } : item))
  t.mock.timers.tick(3000)
  await flush()
  assert.equal(FakeEventSource.instances.length, 2)
  assert.match(FakeEventSource.instances[1].url, /after=4$/, 'the stream still resumes after the last known seq')
  FakeEventSource.instances[1].emit('open')
  await flush()
  assert.deepEqual(translation('m3'), { locale: 'en', status: 'done', body: 'Hello' })
  assert.equal(calls.filter(call => call.method === 'GET' && call.path.endsWith('/messages')).at(-1).query.after, 2, 'refetches from the earliest pending translation')

  // 面板关闭期间失败的译文：重新打开（已加载过）也要校准
  items = [...items, message(5, { senderType: 'agent', translation: pending })]
  FakeEventSource.instances[1].emit('update', { type: 'message.created', message: items[4] })
  closePanel()
  items = items.map(item => (item.seq === 5 ? { ...item, translation: { locale: 'en', status: 'failed', body: null } } : item))
  await cs.openWith(undefined, 'floating')
  await flush()
  assert.equal(translation('m5').status, 'failed')
  assert.equal(calls.filter(call => call.method === 'GET' && call.path.endsWith('/messages')).at(-1).query.after, 4)
  closePanel()
})

test('a late pending copy never downgrades a finished translation', () => {
  const done = message(3, { senderType: 'agent', translation: { locale: 'en', status: 'done', body: 'Hello' } })
  const [merged] = timeline.mergeMessages([done], [message(3, { senderType: 'agent', body: 'edited', translation: { locale: 'en', status: 'pending', body: null } })])
  assert.deepEqual([merged.body, merged.translation.status], ['edited', 'done'])
  assert.equal(timeline.syncAfter([message(1), done, message(4, { translation: { locale: 'en', status: 'pending', body: null } }), message(6)]), 3)
  assert.equal(timeline.syncAfter([message(1), done]), 3)
})

test('?cs=open from reply emails opens the panel and removes the query; the launcher shows unread replies', async () => {
  setup({ loggedIn: true, respond: call => (call.path.endsWith('/conversations/current') ? { conversation: conversation(), contexts: [], unreadCount: 3, agentsOnline: true } : undefined) })
  const { unmount, container, router } = await mount()
  assert.equal(container.querySelector('[data-cs-unread]')?.textContent.trim(), '3')
  await router.push('/?cs=open&utm=mail')
  await settle()
  assert.deepEqual(router.currentRoute.value.query, { utm: 'mail' })
  assert.equal(cs.useCustomerService().state.open, true)
  assertNoNode(container.querySelector('[data-cs-unread]'), 'unread badge hidden while the panel is open')
  assert.equal(localStorage.getItem('booth-ai:cs-visitor'), null, 'signed-in users never get a visitor')
  unmount()
})

test('the scheme registered by the page can be sent repeatedly as context cards from above the composer and the offline form', async () => {
  const schemeContext = { id: 'ctx-1', entryPoint: 'scheme_detail', createdAt: '2026-10-08T00:00:00Z', kind: 'scheme', schemeCode: 'BS-001',
    snapshot: { schemeCode: 'BS-001', name: '3×3 单开口', lengthMm: 3000, widthMm: 3000, openingCount: 1 } }
  let seq = 10
  let reject = null
  const calls = setup({ respond: call => {
    if (!call.path.endsWith('/contexts')) return
    if (reject) { const failed = reject; reject = null; throw failed }
    return { message: message(++seq, { senderType: 'system', kind: 'context', context: schemeContext }), conversation: conversation() }
  } })
  const { unmount, container } = await mount()
  await cs.openWith(undefined, 'floating')
  await settle()
  assertNoNode(container.querySelector('[data-cs-send-context]'), 'hidden when the page has no scheme')

  cs.setPageContext({ context: { kind: 'scheme', schemeCode: 'BS-001' }, entryPoint: 'scheme_detail', label: 'BS-001' })
  await settle()
  const form = container.querySelector('[data-cs-panel] form')
  assert.equal(form.firstElementChild?.hasAttribute('data-cs-send-context'), true, 'the button sits above the textarea')
  assert.equal(form.querySelector('[data-cs-send-context]').textContent.trim(), '发送当前方案')
  const cards = () => container.querySelector('[data-cs-panel]').textContent.split('3×3 单开口').length - 1
  for (let n = 0; n < 2; n++) {
    container.querySelector('[data-cs-send-context]').click()
    await settle()
  }
  const posts = calls.filter(call => call.path.endsWith('/contexts'))
  assert.deepEqual(posts.map(call => [call.path, call.body]), Array.from({ length: 2 }, () =>
    [`/api/v1/client/customer-service/conversations/${conversationId}/contexts`, { entryPoint: 'scheme_detail', context: { kind: 'scheme', schemeCode: 'BS-001' } }]))
  assert.equal(cards(), 2, 'every click adds a card')
  const covers = [...container.querySelectorAll('[data-cs-scheme-cover] img')].map(img => img.getAttribute('src'))
  assert.deepEqual(covers, Array(2).fill('/api/v1/client/schemes/BS-001/cover'), 'cards use the stable cover address, never a signed URL')
  container.querySelector('[data-cs-scheme-cover]').click()
  await settle()
  assert.equal([...document.body.querySelectorAll('[role="dialog"] img')].some(img => img.getAttribute('src') === '/api/v1/client/schemes/BS-001/cover'), true,
    'clicking the thumbnail opens the preview')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  container.querySelector('[data-cs-scheme-cover] img').dispatchEvent(new Event('error'))
  await settle()
  assert.equal(container.querySelectorAll('[data-cs-scheme-cover]').length, 1, 'a broken cover falls back to the icon')
  assert.equal(container.querySelector('[data-cs-send-context]').disabled, false)
  assert.equal(calls.filter(call => call.path.endsWith('/conversations')).length, 1, 'sending never re-opens with a context')

  reject = failure(409, 'CONVERSATION_CLOSED')
  assert.equal(await cs.sendPageContext(), true)
  assert.deepEqual(calls.filter(call => call.path.endsWith('/conversations')).at(-1).body, { entryPoint: 'floating' }, 'a closed round is reopened before resending')
  assert.equal(calls.filter(call => call.path.endsWith('/contexts')).length, 4)

  reject = failure(429, 'RATE_LIMITED')
  assert.equal(await cs.sendPageContext(), false)
  await settle()
  assert.match(container.textContent, /发送太频繁/)

  const { state } = cs.useCustomerService()
  state.agentsOnline = false
  await settle()
  const offline = container.querySelector('[data-cs-offline]')
  assert.equal(offline.querySelector('[data-cs-send-context] + textarea') !== null, true, 'offline form: the button sits right above the textarea')

  cs.setPageContext(null)
  await settle()
  assertNoNode(container.querySelector('[data-cs-send-context]'), 'cleared when leaving the scheme page')
  unmount()
})

test('a card sent from the theme result page shows its selected effect through the context address and is labelled as AI themed', async () => {
  const card = (id, extra = {}) => ({ id, entryPoint: 'scheme_detail', createdAt: '2026-10-08T00:00:00Z', kind: 'scheme', schemeCode: 'BS-001',
    snapshot: { schemeCode: 'BS-001', name: '3×3 单开口', lengthMm: 3000, widthMm: 3000, openingCount: 1, ...extra } })
  setup({ messages: [
    message(1, { senderType: 'system', kind: 'context', context: card('ctx-plain') }),
    message(2, { senderType: 'system', kind: 'context', context: card('ctx-theme', { themeResultId: 'result-1' }) }),
  ] })
  const { unmount, container } = await mount()
  await cs.openWith(undefined, 'floating')
  await settle()
  const covers = [...container.querySelectorAll('[data-cs-scheme-cover] img')].map(img => img.getAttribute('src'))
  assert.deepEqual(covers, ['/api/v1/client/schemes/BS-001/cover', '/api/v1/client/customer-service/contexts/ctx-theme/theme-cover'])
  const labels = [...container.querySelectorAll('[data-cs-themed]')].map(node => node.textContent.trim())
  assert.deepEqual(labels, ['AI 换主题效果'], 'only the themed card is labelled')
  unmount()
})

test('the project detail registers its project: the panel offers "send this project" and every consult click opens with the project card', async () => {
  const projectId = '33333333-3333-4333-8333-333333333333'
  const projectContext = { id: 'ctx-p', entryPoint: 'my_project', createdAt: '2026-10-08T00:00:00Z', kind: 'project', projectId,
    snapshot: { projectNo: 'PJ-00000076', schemeCode: null, sourceType: 'quote_request', status: 'following', exhibitionName: '常州新能源', city: '天津市' } }
  let seq = 20
  let limited = false
  const calls = setup({ loggedIn: true, respond: call => {
    if (call.path.endsWith('/conversations') && call.body.context) {
      if (limited) throw failure(429, 'RATE_LIMITED')
      return { conversation: conversation(), contexts: [projectContext], agentsOnline: true }
    }
    if (call.path.endsWith('/contexts')) return { message: message(++seq, { senderType: 'system', kind: 'context', context: projectContext }), conversation: conversation() }
  } })
  const { unmount, container } = await mount()
  cs.setPageContext({ context: { kind: 'project', projectId }, entryPoint: 'my_project', label: 'PJ-00000076' })
  for (let n = 0; n < 2; n++) await cs.openWith({ kind: 'project', projectId }, 'my_project')
  await settle()
  const opens = calls.filter(call => call.path.endsWith('/conversations'))
  assert.deepEqual(opens.map(call => call.body), Array(2).fill({ entryPoint: 'my_project', context: { kind: 'project', projectId } }),
    'each consult click carries the project so the server appends a card every time')

  const button = container.querySelector('[data-cs-send-context]')
  assert.equal(button.textContent.trim(), '发送当前项目')
  assert.equal(button.getAttribute('title'), '项目 · PJ-00000076')
  button.click()
  await settle()
  assert.deepEqual(calls.filter(call => call.path.endsWith('/contexts')).map(call => call.body), [{ entryPoint: 'my_project', context: { kind: 'project', projectId } }])
  assert.match(container.querySelector('[data-cs-panel]').textContent, /PJ-00000076/)
  assert.match(container.querySelector('[data-cs-panel]').textContent, /常州新能源天津市 · 跟进中/, 'the card shows the localized project status')
  assert.doesNotMatch(container.querySelector('[data-cs-panel]').textContent, /following/)

  limited = true
  await cs.openWith({ kind: 'project', projectId }, 'my_project')
  await settle()
  const { state } = cs.useCustomerService()
  assert.equal(state.open, true, 'a rate-limited card still opens the panel')
  assert.deepEqual(calls.filter(call => call.path.endsWith('/conversations')).at(-1).body, { entryPoint: 'my_project' })
  assert.match(container.textContent, /发送太频繁/)
  unmount()
})

test('responses started before logout and an account switch never restore the previous account', async () => {
  const conversationB = '22222222-2222-4222-8222-222222222222'
  const held = []
  const hold = data => new Promise(resolve => held.push(() => resolve(data)))
  let account = 'A'
  const calls = setup({ loggedIn: true, respond: call => {
    if (account === 'B') {
      if (call.path.endsWith('/conversations')) return { conversation: conversation({ id: conversationB, conversationNo: 'CS-00000002' }), contexts: [], agentsOnline: false }
      if (call.path.endsWith('/messages') && call.method === 'GET') return { items: [message(1, { id: 'b1', conversationId: conversationB, body: 'from B' })], hasMore: false }
      return
    }
    if (call.path.endsWith('/messages') && call.method === 'GET') return hold({ items: [message(5, { senderType: 'agent', body: 'from A' })], hasMore: true })
    if (call.path.endsWith('/conversations/current')) return hold({ conversation: conversation(), contexts: [], unreadCount: 7, agentsOnline: true })
  } })
  const { state } = cs.useCustomerService()
  const openingA = cs.openWith(undefined, 'floating')
  const refreshingA = cs.refreshCurrent()
  await settle()
  assert.equal(held.length, 2, 'A history and current-conversation requests are in flight')

  globalThis.__cs.auth = { isLoggedIn: false, currentUser: null }
  cs.resetCustomerService()
  account = 'B'
  globalThis.__cs.auth = { isLoggedIn: true, currentUser: { email: 'b@example.com' } }
  await cs.handleCustomerServiceLogin()
  await cs.openWith(undefined, 'floating')

  for (const release of held) release()
  await openingA
  await assert.rejects(refreshingA)
  await settle()
  assert.equal(state.conversation.id, conversationB)
  assert.deepEqual(state.messages.map(item => item.body), ['from B'])
  assert.deepEqual([state.hasMore, state.unreadCount, state.agentsOnline, state.busy, state.notice], [false, 0, false, false, ''])
  assert.deepEqual(FakeEventSource.instances.map(source => [source.closed, source.url.includes(conversationB)]), [[false, true]], 'only B is connected')
  assert.equal(calls.filter(call => call.path.endsWith('/read')).length, 0, 'the agent reply of A is never marked read')
})

test('after logout, a response from the previous account leaves the state cleared and opens no stream', async () => {
  let release
  const calls = setup({ loggedIn: true, respond: call => {
    if (call.path.endsWith('/messages') && call.method === 'GET') return new Promise(resolve => { release = () => resolve({ items: [message(1, { senderType: 'agent' })], hasMore: true }) })
  } })
  const { state } = cs.useCustomerService()
  const opening = cs.openWith(undefined, 'floating')
  await settle()
  cs.resetCustomerService()
  release()
  await opening
  await settle()
  assert.deepEqual([state.open, state.conversation, state.messages.length, state.loaded, state.unreadCount, state.connection, state.busy, state.notice],
    [false, null, 0, false, 0, 'idle', false, ''])
  assert.equal(FakeEventSource.instances.length, 0)
  assert.equal(calls.some(call => call.path.endsWith('/events-ticket')), false)
})

test('a stream ticket requested before an account switch does not open a second stream for the merged conversation', async () => {
  let releaseTicket
  setup({ loggedIn: true, respond: call => {
    if (call.path.endsWith('/events-ticket') && !releaseTicket) return new Promise(resolve => { releaseTicket = () => resolve({ ticket: 'ticket-stale' }) })
  } })
  await cs.openWith(undefined, 'floating')
  await cs.handleCustomerServiceLogin()
  // 访客会话合并到账号后，新身份打开的仍是同一个会话 ID
  await cs.openWith(undefined, 'floating')
  await settle()
  releaseTicket()
  await settle()
  assert.deepEqual(FakeEventSource.instances.map(source => source.url.match(/ticket=([^&]+)/)[1]), ['ticket-1'])
})
