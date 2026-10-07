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
const { emptyRequirement } = await server.ssrLoadModule('/src/features/selection/types.ts')
const { selectionSnapshot, writeSelectionSession } = await server.ssrLoadModule('/src/features/selection/session.ts')
const { writeManualHandoff } = await server.ssrLoadModule('/src/features/selection/handoff.ts')
const user = { id: 'test-user', username: '测试用户', nickname: '测试用户', city: '上海', email: '', mobile: '', company: '' }
const validForm = { exhibitionName: '上海测试展', countryCode: 'CN', city: '上海', startDate: '2026-11-01', endDate: '2026-11-04', scopeCodes: ['materials'], scopeNotes: '保留范围说明', currency: 'CNY', amount: '30000', customerType: 'individual', company: '', contactName: '王测试', email: 'test@example.com', phone: '', notes: '不能丢失的补充说明' }
const draftKey = manual => manual ? 'booth:manual-draft' : 'booth:quote-draft:SC-6030:standard:pending'
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise(resolve => setTimeout(resolve, 5)) } }
async function mount({ manual = false, form = {}, description = '需要科技感展台', restore = false, selection, query = '', respond } = {}) {
  if (!restore) {
    sessionStorage.clear()
    sessionStorage.setItem(draftKey(manual), JSON.stringify({ owner: user.id, form: { ...validForm, ...form }, pending: null, pendingManual: null, originalDescription: description }))
    if (selection) writeSelectionSession(selection)
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
      if (respond) await respond(calls.filter(call => call.method === 'POST').length)
      return { code: 0, data: { projectId: 'project-1', projectNo: 'PJ-001', requestNo: 'REQ-001', status: 'pending', revision: 1 } }
    },
  }
  const container = document.createElement('div'); document.body.append(container)
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/manual-request', name: 'ManualRequest', component: { render: () => null } },
    { path: '/schemes/:code/quote', name: 'QuoteRequest', component: { render: () => null } },
    { path: '/:pathMatch(.*)*', component: { render: () => null } },
  ] })
  await router.push(manual ? '/manual-request' : `/schemes/SC-6030/quote${query}`); await router.isReady()
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
const selectionRequirement = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, styleIds: ['modern-minimal'] }
const selectionText = '6x3 现代简约展台，需要洽谈区'
const selectionDifference = { field: 'maxHeightMm', requested: '4 m', actual: '4.5 m', reason: '高度略高于需求' }
function selectionSession({ code = 'SC-6030', mode = 'filtered', searchId = 'search-1', stale = false } = {}) {
  const item = { code, matchType: mode === 'random' ? 'random' : 'reference', images: [],
    specifications: { lengthMm: 6000, widthMm: 3000, heightMm: 4500, areaM2: 18, openingCount: 2, productSystemId: 'standard', productSystemLabel: '标准模块' },
    reasons: [], differences: mode === 'random' ? [] : [selectionDifference], pendingConfirmations: [], preferenceMisses: [] }
  return { requirement: selectionRequirement, text: selectionText, state: 'results',
    snapshot: selectionSnapshot(stale ? { ...selectionRequirement, lengthMm: 9000 } : selectionRequirement, selectionText),
    parseResult: null, parsedText: null, parsedRequirement: null,
    liveMatchData: { status: 'matched', mode, requirement: selectionRequirement, items: [item],
      counts: { direct: 0, reference: mode === 'random' ? 0 : 1, random: mode === 'random' ? 1 : 0, total: 1 },
      diagnostics: { reviewedPublished: 1, ready: 1, exclusions: { unverifiedChecklist: 0, incompleteAssets: 0, invalidData: 0, productSystem: 0, height: 0, tags: 0, dimensions: 0 } },
      reasons: [], suggestions: [], missingFields: [] },
    attemptId: 'attempt-1', parseId: null, searchId, imagesExpiresAt: 0, activeImageByCode: {} }
}
test('manual: AI selection handoff pre-fills the description, pending questions and contact', async () => {
  sessionStorage.clear()
  writeManualHandoff({ originalDescription: selectionText, confirmedRequirements: selectionRequirement, unresolvedQuestions: ['开口数待确认'] }, { owner: user.id, name: '王测试', contact: '13800000000' })
  const mounted = await mount({ manual: true, restore: true })
  try {
    assert.equal(mounted.container.querySelector('#request-description').value, selectionText)
    assert.match(mounted.container.textContent, /开口数待确认/)
    assert.equal(mounted.container.querySelector('#contact').value, '王测试')
    assert.equal(mounted.container.querySelector('#phone').value, '13800000000')
  } finally { await mounted.close() }
})
test('quote: AI selection context is shown and submitted with the original description and confirmed requirements', async () => {
  const mounted = await mount({ selection: selectionSession(), query: '?entryPoint=scheme_detail&searchId=search-1' })
  try {
    assert.match(mounted.container.textContent, /4 m → 4\.5 m：高度略高于需求/)
    await submit(mounted); assert.equal(posts(mounted).length, 1)
    assert.deepEqual(posts(mounted)[0].body.requirementContext, { originalDescription: selectionText, confirmedRequirements: selectionRequirement })
    assert.match(mounted.container.textContent, /申请已受理/)
  } finally { await mounted.close() }
})
for (const scenario of [
  { name: 'stale requirements', selection: { stale: true }, query: '?searchId=search-1' },
  { name: 'another search', selection: {}, query: '?searchId=search-old' },
  { name: 'scheme outside the results', selection: { code: 'SC-9999' }, query: '?searchId=search-1' },
  { name: 'inspiration results', selection: { mode: 'random' }, query: '?searchId=search-1' },
  { name: 'no AI selection session', query: '' },
]) {
  test(`quote: ${scenario.name} is not attached and the quote still submits`, async () => {
    const mounted = await mount({ selection: scenario.selection && selectionSession(scenario.selection), query: scenario.query })
    try {
      assert.doesNotMatch(mounted.container.textContent, /高度略高于需求/)
      await submit(mounted); assert.equal(posts(mounted).length, 1)
      assert.equal('requirementContext' in posts(mounted)[0].body, false)
      assert.match(mounted.container.textContent, /申请已受理/)
    } finally { await mounted.close() }
  })
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
        assertSameNode(document.activeElement, trigger, "document.activeElement vs trigger")
        assert.equal(mounted.container.querySelector(`#request-${scenario.first}-date-error`).textContent, scenario.message)
        assert.equal(posts(mounted).length, 0); assertPreserved(mounted, manual)
        const draft = JSON.parse(sessionStorage.getItem(draftKey(manual)))
        for (const [field, value] of Object.entries(scenario.form)) assert.equal(draft.form[field], value)
        for (const field of ['start', 'end']) {
          const selector = `#request-${field}-date`
          if (mounted.container.querySelector(`${selector}-error`)) await selectDate(mounted.container, selector, validForm[`${field}Date`])
        }
        for (const field of ['start', 'end']) {
          assertNoNode(mounted.container.querySelector(`#request-${field}-date-error`), "mounted.container.querySelector(`#request-${field}-date-error`)")
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
      assertSameNode(document.activeElement, field, "document.activeElement vs field"); assert.equal(posts(mounted).length, 0)
      assertPreserved(mounted, manual)
      field.click(); await settle()
      assertNoNode(mounted.container.querySelector('#request-scopes-error'), "mounted.container.querySelector('#request-scopes-error')")
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
      assertSameNode(document.activeElement, email, "document.activeElement vs email"); assert.equal(posts(mounted).length, 0); assertPreserved(mounted, manual)
      input(mounted.container, '#phone', '+86 13800000000'); await settle()
      assertNoNode(mounted.container.querySelector('#request-contact-error'), "mounted.container.querySelector('#request-contact-error')")
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
      assertSameNode(document.activeElement, field, "document.activeElement vs field"); assert.equal(field.value, '   ')
      assert.equal(posts(mounted).length, 0); assertPreserved(mounted, manual)
      input(mounted.container, '#scope', '需要现场电力配置'); await settle()
      assertNoNode(mounted.container.querySelector('#request-scope-notes-error'), "mounted.container.querySelector('#request-scope-notes-error')")
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
    assertSameNode(document.activeElement, description, "document.activeElement vs description"); assert.equal(description.value, '   ')
    assert.equal(posts(mounted).length, 0); assertPreserved(mounted, true)
    input(mounted.container, '#request-description', '需要科技感展台'); await settle()
    assertNoNode(mounted.container.querySelector('#request-description-error'), "mounted.container.querySelector('#request-description-error')")
    await submit(mounted)
    assertSameNode(document.activeElement, error(mounted.container, '#request-start-date', 'request-start-date-error'), "document.activeElement vs error(mounted.container, '#request-start-date', 'request-start-date-error')")
    await selectDate(mounted.container, '#request-start-date', validForm.startDate); await submit(mounted)
    assertSameNode(document.activeElement, error(mounted.container, '#request-end-date', 'request-end-date-error'), "document.activeElement vs error(mounted.container, '#request-end-date', 'request-end-date-error')")
    await selectDate(mounted.container, '#request-end-date', validForm.endDate); await submit(mounted)
    const scope = error(mounted.container, '#request-scopes button', 'request-scopes-error')
    assertSameNode(document.activeElement, scope, "document.activeElement vs scope")
    scope.click(); await settle(); await submit(mounted)
    assertSameNode(document.activeElement, error(mounted.container, '#email', 'request-contact-error'), "document.activeElement vs error(mounted.container, '#email', 'request-contact-error')")
    assert.equal(posts(mounted).length, 0); assertPreserved(mounted, true)
    input(mounted.container, '#email', validForm.email); await settle(); await submit(mounted)
    assert.equal(posts(mounted).length, 1); assert.equal(posts(mounted)[0].body.originalDescription, '需要科技感展台')
  } finally { await mounted.close() }
})
const httpFailure = (status, reason) => Object.assign(new Error(`HTTP ${status}`), { response: { status }, data: { error: { reason } } })
const draftOf = manual => JSON.parse(sessionStorage.getItem(draftKey(manual)))
test('quote: unconfirmed result keeps the pending submission and the retry reuses its request key', async () => {
  const mounted = await mount({ respond: attempt => { if (attempt === 1) throw httpFailure(502) } })
  try {
    await submit(mounted)
    assert.match(mounted.container.textContent, /暂未确认受理结果/)
    const pending = draftOf(false).pending
    assert.equal(pending.requestKey, posts(mounted)[0].body.requestKey)
    assert.equal(mounted.container.querySelector('fieldset').disabled, true)
    await submit(mounted); assert.equal(posts(mounted).length, 2)
    assert.equal(posts(mounted)[1].body.requestKey, pending.requestKey)
    assert.match(mounted.container.textContent, /申请已受理/)
    assert.equal(draftOf(false).pending, null)
  } finally { await mounted.close() }
})
test('quote: version conflict drops the pending submission; refreshing context allows a new request key', async () => {
  const mounted = await mount({ respond: attempt => { if (attempt === 1) throw httpFailure(409) } })
  try {
    await submit(mounted)
    assert.match(mounted.container.textContent, /资料或主题选择已更新/)
    assert.equal(draftOf(false).pending, null)
    assert.equal(mounted.container.querySelector('button[type="submit"]').disabled, true)
    const refresh = [...mounted.container.querySelectorAll('button')].find(button => button.textContent.includes('刷新'))
    assert.ok(refresh, 'refresh button must be shown on conflict')
    refresh.click(); await settle()
    assert.equal(mounted.container.querySelector('button[type="submit"]').disabled, false)
    await submit(mounted); assert.equal(posts(mounted).length, 2)
    assert.notEqual(posts(mounted)[1].body.requestKey, posts(mounted)[0].body.requestKey)
    assert.match(mounted.container.textContent, /申请已受理/)
  } finally { await mounted.close() }
})
test('manual: a pending submission is discarded instead of resent after the account changes', async () => {
  const mounted = await mount({ manual: true, respond: attempt => { if (attempt === 1) throw httpFailure(503) } })
  try {
    await submit(mounted)
    assert.ok(draftOf(true).pendingManual, 'pending manual request must be kept after an unconfirmed result')
    globalThis.__quoteRequest.auth.currentUser = { ...user, id: 'another-user' }
    await submit(mounted)
    assert.equal(posts(mounted).length, 1)
    assert.match(mounted.container.textContent, /登录账户已变化，请重新确认。/)
    assert.equal(draftOf(true).pendingManual, null)
    assert.equal(mounted.container.querySelector('fieldset').disabled, false)
  } finally { await mounted.close() }
})
