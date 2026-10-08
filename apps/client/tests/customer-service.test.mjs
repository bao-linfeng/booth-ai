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
      const call = { path, method: options.method ?? 'GET', body: options.body, query: options.query }
      calls.push(call)
      const custom = await respond?.(call, calls)
      if (custom !== undefined) return { code: 0, data: custom }
      if (path.endsWith('/visitors')) return { code: 0, data: { visitorToken: `token-${++issued}`, visitorId: 'v1' } }
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
  localStorage.removeItem('booth-ai:cs-visitor-token')
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

test('visitors get a lazily issued token, open with context, subscribe after the last seq and fall back when the context is unavailable', async () => {
  const calls = setup({
    messages: [message(1), message(2, { senderType: 'agent' })],
    respond: call => {
      if (call.path.endsWith('/conversations') && call.body.context) throw failure(404, 'CONTEXT_NOT_FOUND')
    },
  })
  const { unmount, container } = await mount()
  await cs.openWith({ kind: 'project', projectId: 'p-1' }, 'quote_receipt')
  await settle()
  assert.equal(localStorage.getItem('booth-ai:cs-visitor-token'), 'token-1')
  const opens = calls.filter(call => call.path.endsWith('/conversations'))
  assert.deepEqual(opens.map(call => call.body), [{ entryPoint: 'quote_receipt', context: { kind: 'project', projectId: 'p-1' } }, { entryPoint: 'quote_receipt' }])
  assert.equal(calls.filter(call => call.path.endsWith('/visitors')).length, 1, 'concurrent calls share one issued token')
  assert.match(container.textContent, /无法附带该方案或项目/)
  assert.equal(FakeEventSource.instances.length, 1)
  assert.match(FakeEventSource.instances[0].url, /\/conversations\/11111111-1111-4111-8111-111111111111\/events\?ticket=ticket-1&after=2$/)
  assert.deepEqual(calls.filter(call => call.path.endsWith('/read')).map(call => call.body), [{ seq: 2 }])
  assertNoNode(container.querySelector('[data-cs-offline]'), 'agents online: chat composer instead of the offline form')
  assert.match(container.querySelector('[data-cs-status]').textContent, /排队中/)
  unmount()
})

test('an invalidated visitor token is cleared, reissued and the request retried once', async () => {
  localStorage.setItem('booth-ai:cs-visitor-token', 'stale-token')
  let rejected = false
  const calls = setup({ respond: call => {
    if (call.path.endsWith('/conversations') && !rejected) { rejected = true; throw failure(401, 'VISITOR_REQUIRED') }
  } })
  await cs.openWith(undefined, 'floating')
  assert.equal(localStorage.getItem('booth-ai:cs-visitor-token'), 'token-1')
  assert.equal(calls.filter(call => call.path.endsWith('/conversations')).length, 2)
  assert.equal(cs.useCustomerService().state.notice, '')
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

test('?cs=open from reply emails opens the panel and removes the query; the launcher shows unread replies', async () => {
  setup({ loggedIn: true, respond: call => (call.path.endsWith('/conversations/current') ? { conversation: conversation(), contexts: [], unreadCount: 3, agentsOnline: true } : undefined) })
  const { unmount, container, router } = await mount()
  assert.equal(container.querySelector('[data-cs-unread]')?.textContent.trim(), '3')
  await router.push('/?cs=open&utm=mail')
  await settle()
  assert.deepEqual(router.currentRoute.value.query, { utm: 'mail' })
  assert.equal(cs.useCustomerService().state.open, true)
  assertNoNode(container.querySelector('[data-cs-unread]'), 'unread badge hidden while the panel is open')
  assert.equal(localStorage.getItem('booth-ai:cs-visitor-token'), null, 'signed-in users never get a visitor token')
  unmount()
})
