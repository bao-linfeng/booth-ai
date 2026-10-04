import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'sessionStorage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLSelectElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
registerTS(() => ts)
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [{
    name: 'test-quote-request', enforce: 'pre',
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
      if (id === '\0test-api') return "export const API_BASE_URL = ''; export const apiFetch = (...args) => globalThis.__quoteRequest.apiFetch(...args); export const lingtongPublicFetch = (...args) => globalThis.__quoteRequest.dictionary(...args)"
      if (id === '\0test-auth') return 'export const useAuthStore = () => globalThis.__quoteRequest.auth'
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
after(async () => { delete globalThis.__quoteRequest; await server.close(); await window.happyDOM.close() })
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: QuoteRequest } = await server.ssrLoadModule('/src/pages/QuoteRequest.vue')
const user = { id: 'test-user', username: '测试用户', nickname: '测试用户', city: '上海', email: '', mobile: '', company: '' }
const validForm = { exhibitionName: '上海测试展', countryCode: 'CN', city: '上海', startDate: '2026-11-01', endDate: '2026-11-04', scopeCodes: ['materials'], scopeNotes: '保留范围说明', currency: 'CNY', amount: '30000', customerType: 'individual', company: '', contactName: '王测试', email: 'test@example.com', phone: '', notes: '不能丢失的补充说明' }
const draftKey = manual => manual ? 'booth:manual-draft' : 'booth:quote-draft:SC-6030:standard:pending'
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise(resolve => setTimeout(resolve, 5)) } }
async function mount({ manual = false, form = {}, description = '需要科技感展台', restore = false } = {}) {
  if (!restore) {
    sessionStorage.clear()
    sessionStorage.setItem(draftKey(manual), JSON.stringify({ owner: user.id, form: { ...validForm, ...form }, pending: null, pendingManual: null, originalDescription: description }))
  }
  const calls = []
  globalThis.__quoteRequest = {
    auth: { isLoggedIn: true, currentUser: user },
    dictionary: async path => ({ data: path.endsWith('queryCountries') ? [{ dictKey: 'CN', dictValue: '中国' }] : [{ dictKey: 'SH', dictValue: '上海' }] }),
    apiFetch: async (path, options) => {
      calls.push({ path, method: options?.method ?? 'GET', body: options?.body ? JSON.parse(JSON.stringify(options.body)) : undefined })
      if (path.endsWith('/quote-context')) return { code: 0, data: { schemeCode: 'SC-6030', schemeRevision: 1, bomRevision: 7, drawingRevision: 1, artworkRevision: 1, materialsStatus: { bom: 'available', drawings: 'available', artworks: 'available' } } }
      if (path === '/api/v1/client/schemes/SC-6030') return { code: 0, data: { images: [] } }
      assert.equal(path, manual ? '/api/v1/client/manual-requests' : '/api/v1/client/quote-requests')
      assert.equal(options.method, 'POST')
      return { code: 0, data: { projectId: 'project-1', projectNo: 'PJ-001', requestNo: 'REQ-001', status: 'pending', revision: 1 } }
    },
  }
  const container = document.createElement('div'); document.body.append(container)
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/manual-request', name: 'ManualRequest', component: { render: () => null } },
    { path: '/schemes/:code/quote', name: 'QuoteRequest', component: { render: () => null } },
    { path: '/:pathMatch(.*)*', component: { render: () => null } },
  ] })
  await router.push(manual ? '/manual-request' : '/schemes/SC-6030/quote'); await router.isReady()
  const app = createApp({ render: () => h(QuoteRequest) }); app.use(router); app.mount(container); await settle()
  return { container, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}
function input(container, selector, value) { const e = container.querySelector(selector); assert.ok(e, selector); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })) }
async function submit(mounted) { mounted.container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle() }
const posts = mounted => mounted.calls.filter(call => call.method === 'POST')
function error(container, selector, errorId) {
  const e = container.querySelector(selector), message = container.querySelector('#' + errorId)
  assert.ok(e); assert.ok(message); assert.equal(message.getAttribute('role'), 'alert')
  assert.equal(e.getAttribute('aria-invalid'), 'true'); assert.equal(e.getAttribute('aria-describedby'), errorId)
  return e
}
function assertPreserved(mounted, manual) {
  for (const [selector, value] of [['#exhibition', validForm.exhibitionName], ['#budget', validForm.amount], ['#contact', validForm.contactName], ['#notes', validForm.notes]]) assert.equal(mounted.container.querySelector(selector).value, value)
  const draft = JSON.parse(sessionStorage.getItem(draftKey(manual)))
  assert.equal(draft.form.exhibitionName, validForm.exhibitionName); assert.equal(draft.form.notes, validForm.notes)
  assert.equal(draft.pending, null); assert.equal(draft.pendingManual, null)
}
async function selectDate(container, selector, value) {
  const trigger = container.querySelector(selector)
  assert.equal(trigger.tagName, 'BUTTON')
  trigger.click(); await settle()
  let day = document.querySelector(`[data-radix-vue-calendar-cell-trigger][data-value="${value}"]`)
  for (let i = 0; !day && i < 12; i++) {
    const next = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === '›')
    assert.ok(next, 'Real calendar next-month control must be present')
    next.click(); await settle()
    day = document.querySelector(`[data-radix-vue-calendar-cell-trigger][data-value="${value}"]`)
  }
  assert.ok(day, 'Real calendar day must be present')
  assert.equal(day.hasAttribute('data-disabled'), false)
  day.click()
  await settle()
  assert.notEqual(trigger.getAttribute('data-state'), 'open')
}
for (const manual of [false, true]) {
  const label = manual ? 'manual' : 'quote'
  for (const scenario of [
    { name: 'both dates empty', form: { startDate: '', endDate: '' }, first: 'start', message: '请选择开展日期。' },
    { name: 'end date empty', form: { endDate: '' }, first: 'end', message: '请选择结束日期。' },
    { name: 'impossible start date', form: { startDate: '2026-02-30' }, first: 'start', message: '开展日期无效，请重新选择。' },
    { name: 'malformed end date', form: { endDate: 'not-a-date' }, first: 'end', message: '结束日期无效，请重新选择。' },
    { name: 'end precedes start', form: { endDate: '2026-10-31' }, first: 'end', message: '结束日期不能早于开展日期。' },
  ]) {
    test(`${label}: ${scenario.name} is blocked locally; real calendar repair clears errors, keeps draft and submits`, async () => {
      const mounted = await mount({ manual, form: scenario.form })
      try {
        input(mounted.container, '#notes', validForm.notes); await settle(); await submit(mounted)
        const trigger = error(mounted.container, `#request-${scenario.first}-date`, `request-${scenario.first}-date-error`)
        assert.equal(trigger.tagName, 'BUTTON'); assert.equal(trigger.getAttribute('aria-required'), 'true')
        assert.equal(mounted.container.querySelectorAll(`#request-${scenario.first}-date`).length, 1)
        assert.equal(trigger.parentElement.querySelector(`[for="request-${scenario.first}-date"]`).tagName, 'LABEL')
        assert.equal(document.activeElement, trigger)
        assert.equal(mounted.container.querySelector(`#request-${scenario.first}-date-error`).textContent, scenario.message)
        assert.equal(posts(mounted).length, 0); assertPreserved(mounted, manual)
        const draft = JSON.parse(sessionStorage.getItem(draftKey(manual)))
        for (const [field, value] of Object.entries(scenario.form)) assert.equal(draft.form[field], value)
        for (const field of ['start', 'end']) {
          const selector = `#request-${field}-date`
          if (mounted.container.querySelector(`${selector}-error`)) await selectDate(mounted.container, selector, validForm[`${field}Date`])
        }
        for (const field of ['start', 'end']) {
          assert.equal(mounted.container.querySelector(`#request-${field}-date-error`), null)
          assert.notEqual(mounted.container.querySelector(`#request-${field}-date`).getAttribute('aria-invalid'), 'true')
        }
        assertPreserved(mounted, manual)
        const repaired = JSON.parse(sessionStorage.getItem(draftKey(manual))).form
        assert.equal(repaired.startDate, validForm.startDate); assert.equal(repaired.endDate, validForm.endDate)
        await submit(mounted); assert.equal(posts(mounted).length, 1)
        assert.equal(posts(mounted)[0].body.exhibition.startDate, validForm.startDate)
        assert.equal(posts(mounted)[0].body.exhibition.endDate, validForm.endDate)
        assert.match(mounted.container.textContent, /申请已受理/)
      } finally { await mounted.close() }
    })
  }
  test(`${label}: empty scope is local, first invalid field receives focus, no POST; repair clears error and preserves draft`, async () => {
    const mounted = await mount({ manual, form: { scopeCodes: [] } })
    try {
      input(mounted.container, '#notes', '不能丢失的补充说明'); await settle(); await submit(mounted)
      const field = error(mounted.container, '#request-scopes button', 'request-scopes-error')
      assert.equal(document.activeElement, field); assert.equal(posts(mounted).length, 0)
      assertPreserved(mounted, manual)
      field.click(); await settle()
      assert.equal(mounted.container.querySelector('#request-scopes-error'), null)
      assert.notEqual(field.getAttribute('aria-invalid'), 'true')
      await submit(mounted); assert.equal(posts(mounted).length, 1)
      assert.deepEqual(posts(mounted)[0].body.scopeCodes, ['materials'])
    } finally { await mounted.close() }
  })
  test(`${label}: blank email and phone show associated nearby error; repair removes it without losing other input`, async () => {
    const mounted = await mount({ manual, form: { email: ' ', phone: ' ' } })
    try {
      input(mounted.container, '#notes', validForm.notes); await settle(); await submit(mounted)
      const email = error(mounted.container, '#email', 'request-contact-error')
      error(mounted.container, '#phone', 'request-contact-error')
      assert.equal(document.activeElement, email); assert.equal(posts(mounted).length, 0); assertPreserved(mounted, manual)
      input(mounted.container, '#phone', '+86 13800000000'); await settle()
      assert.equal(mounted.container.querySelector('#request-contact-error'), null)
      assert.notEqual(email.getAttribute('aria-invalid'), 'true')
      await submit(mounted); assert.equal(posts(mounted).length, 1)
      assert.deepEqual(posts(mounted)[0].body.contact, { name: validForm.contactName, phone: '+86 13800000000' })
    } finally { await mounted.close() }
  })
  test(`${label}: other scope with whitespace description is blocked; correcting it clears local error and submits exact value`, async () => {
    const mounted = await mount({ manual, form: { scopeCodes: ['other'], scopeNotes: '   ' } })
    try {
      input(mounted.container, '#notes', validForm.notes); await settle(); await submit(mounted)
      const field = error(mounted.container, '#scope', 'request-scope-notes-error')
      assert.equal(document.activeElement, field); assert.equal(field.value, '   ')
      assert.equal(posts(mounted).length, 0); assertPreserved(mounted, manual)
      input(mounted.container, '#scope', '需要现场电力配置'); await settle()
      assert.equal(mounted.container.querySelector('#request-scope-notes-error'), null)
      await submit(mounted); assert.equal(posts(mounted).length, 1)
      assert.equal(posts(mounted)[0].body.scopeNotes, '需要现场电力配置')
    } finally { await mounted.close() }
  })
  test(`${label}: invalid submission persists changed values; remount restores editable draft and valid submission still calls API`, async () => {
    let mounted = await mount({ manual, form: { email: '', phone: '' } })
    try {
      input(mounted.container, '#notes', '重新挂载后仍保留'); await settle(); await submit(mounted)
      assert.equal(posts(mounted).length, 0); await mounted.close()
      mounted = await mount({ manual, restore: true })
      assert.equal(mounted.container.querySelector('#notes').value, '重新挂载后仍保留')
      assert.equal(mounted.container.querySelector('#exhibition').value, validForm.exhibitionName)
      input(mounted.container, '#email', validForm.email); await settle(); await submit(mounted)
      assert.equal(posts(mounted).length, 1)
      assert.equal(posts(mounted)[0].body.notes, '重新挂载后仍保留')
      assert.deepEqual(posts(mounted)[0].body.exhibition, { name: validForm.exhibitionName, countryCode: 'CN', city: '上海', startDate: validForm.startDate, endDate: validForm.endDate })
      assert.match(mounted.container.textContent, /申请已受理/)
    } finally { await mounted.close() }
  })
}
test('manual: first-error focus follows description > dates > scope > contact; repairs preserve input and submit', async () => {
  const mounted = await mount({ manual: true, description: '   ', form: { startDate: '', endDate: '', scopeCodes: [], email: '', phone: '' } })
  try {
    input(mounted.container, '#notes', validForm.notes); await settle(); await submit(mounted)
    const description = error(mounted.container, '#request-description', 'request-description-error')
    assert.equal(document.activeElement, description); assert.equal(description.value, '   ')
    assert.equal(posts(mounted).length, 0); assertPreserved(mounted, true)
    input(mounted.container, '#request-description', '需要科技感展台'); await settle()
    assert.equal(mounted.container.querySelector('#request-description-error'), null)
    await submit(mounted)
    assert.equal(document.activeElement, error(mounted.container, '#request-start-date', 'request-start-date-error'))
    await selectDate(mounted.container, '#request-start-date', validForm.startDate); await submit(mounted)
    assert.equal(document.activeElement, error(mounted.container, '#request-end-date', 'request-end-date-error'))
    await selectDate(mounted.container, '#request-end-date', validForm.endDate); await submit(mounted)
    const scope = error(mounted.container, '#request-scopes button', 'request-scopes-error')
    assert.equal(document.activeElement, scope)
    scope.click(); await settle(); await submit(mounted)
    assert.equal(document.activeElement, error(mounted.container, '#email', 'request-contact-error'))
    assert.equal(posts(mounted).length, 0); assertPreserved(mounted, true)
    input(mounted.container, '#email', validForm.email); await settle(); await submit(mounted)
    assert.equal(posts(mounted).length, 1); assert.equal(posts(mounted)[0].body.originalDescription, '需要科技感展台')
  } finally { await mounted.close() }
})
