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
const { getVisitorId } = await server.ssrLoadModule('/src/lib/visitor-id.ts')
const user = { id: 'test-user', username: '测试用户', nickname: '测试用户', city: '上海', email: '', mobile: '', company: '' }
const validForm = { exhibitionName: '上海测试展', countryCode: 'CN', city: '上海', startDate: '2026-11-01', endDate: '2026-11-04', scopeCodes: ['materials'], scopeNotes: '保留范围说明', currency: 'CNY', amount: '30000', customerType: 'individual', company: '', contactName: '王测试', email: 'test@example.com', phone: '', notes: '不能丢失的补充说明' }
const draftKey = (manual, themeJobId = 'standard', artworkJobId = 'pending') => manual ? 'booth:manual-draft' : `booth:quote-draft:SC-6030:${themeJobId}:${artworkJobId}`
async function settle() { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise(resolve => setTimeout(resolve, 5)) } }
async function mount({ manual = false, form = {}, description = '需要科技感展台', restore = false, selection, query = '', respond, themeJob, artworkJob, draft = {},
  auth = { isLoggedIn: true, currentUser: user }, context, failures = {}, dictionary } = {}) {
  if (!restore) {
    sessionStorage.clear()
    sessionStorage.setItem(draftKey(manual, themeJob?.jobId, artworkJob?.jobId), JSON.stringify({ owner: user.id, form: { ...validForm, ...form }, pending: null, pendingManual: null, originalDescription: description, ...draft }))
    if (selection) writeSelectionSession(selection)
  }
  const calls = []
  let contextReads = 0
  globalThis.__quoteRequest = {
    auth,
    dictionary: dictionary ?? (async path => ({ data: path.endsWith('queryCountries') ? [{ dictKey: 'CN', dictValue: '中国' }] : [{ dictKey: 'SH', dictValue: '上海' }] })),
    apiFetch: async (path, options) => {
      calls.push({ path, method: options?.method ?? 'GET', body: options?.body ? JSON.parse(JSON.stringify(options.body)) : undefined })
      if (failures[path]) throw failures[path]
      if (path.endsWith('/quote-context')) {
        if (context) await context(++contextReads)
        return { code: 0, data: { schemeCode: 'SC-6030', schemeRevision: 1, bomRevision: 7, drawingRevision: 1, artworkRevision: 1, materialsStatus: { bom: 'available', drawings: 'available', artworks: 'available' } } }
      }
      if (path === '/api/v1/client/schemes/SC-6030') return { code: 0, data: { images: [] } }
      if (themeJob && path === `/api/v1/client/theme-jobs/${themeJob.jobId}`) return { code: 0, data: structuredClone(themeJob) }
      if (artworkJob && path === `/api/v1/client/artwork-jobs/${artworkJob.jobId}`) return { code: 0, data: structuredClone(artworkJob) }
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
    attemptId: 'attempt-1', visitorId: getVisitorId(), parseId: null, searchId, imagesExpiresAt: 0, activeImageByCode: {} }
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
  { name: 'route without the source search', selection: {}, query: '?entryPoint=scheme_detail' },
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
function themeJob(searchId) {
  return { jobId: 'theme-1', schemeCode: 'SC-6030', searchId, status: 'succeeded', phase: null, requestedCount: 1, usableCount: 1,
    original: { assetId: 'asset-1', previewUrl: '/original.png' }, results: [{ resultId: 'result-1', previewUrl: '/result.png', width: 1600, height: 900 }],
    selection: { resultId: 'result-1', revision: 2 }, credits: { status: 'settled', reservedCredits: 1, chargedCredits: 1, releasedCredits: 0 }, failure: null, pollAfterMs: null }
}
test('quote: theme result uses the requirements of the search recorded on the theme job', async () => {
  const mounted = await mount({ selection: selectionSession(), themeJob: themeJob('search-1'), query: '?themeJobId=theme-1' })
  try {
    assert.match(mounted.container.textContent, /高度略高于需求/)
    await submit(mounted); assert.equal(posts(mounted).length, 1)
    assert.deepEqual(posts(mounted)[0].body.requirementContext, { originalDescription: selectionText, confirmedRequirements: selectionRequirement })
    assert.deepEqual(posts(mounted)[0].body.themeSelection, { themeJobId: 'theme-1', resultId: 'result-1', selectionRevision: 2 })
  } finally { await mounted.close() }
})
for (const scenario of [
  { name: 'from another search of the same scheme', searchId: 'search-old', query: '?themeJobId=theme-1' },
  { name: 'from another search even when the route names the current one', searchId: 'search-old', query: '?themeJobId=theme-1&searchId=search-1' },
  { name: 'not created from AI selection', searchId: null, query: '?themeJobId=theme-1' },
]) {
  test(`quote: theme result ${scenario.name} does not attach the current selection requirements`, async () => {
    const mounted = await mount({ selection: selectionSession(), themeJob: themeJob(scenario.searchId), query: scenario.query })
    try {
      assert.doesNotMatch(mounted.container.textContent, /高度略高于需求/)
      await submit(mounted); assert.equal(posts(mounted).length, 1)
      assert.equal('requirementContext' in posts(mounted)[0].body, false)
      assert.equal(posts(mounted)[0].body.themeSelection.themeJobId, 'theme-1')
    } finally { await mounted.close() }
  })
}
test('quote: a selection session owned by a previous visitor is discarded', async () => {
  const mounted = await mount({ selection: { ...selectionSession(), visitorId: 'v_previous_visitor' }, query: '?entryPoint=scheme_detail&searchId=search-1' })
  try {
    assert.doesNotMatch(mounted.container.textContent, /高度略高于需求/)
    await submit(mounted); assert.equal(posts(mounted).length, 1)
    assert.equal('requirementContext' in posts(mounted)[0].body, false)
    assert.equal(sessionStorage.getItem('booth-ai:ai-selection'), null)
  } finally { await mounted.close() }
})
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
const buttonByText = (container, text) => [...container.querySelectorAll('button')].find(button => button.textContent.trim() === text)
const submitButton = container => container.querySelector('button[type="submit"]')
// 页面代码在调用时才解析全局 sessionStorage，替换全局对象即可注入存储故障
async function withStorage(overrides, run) {
  const real = globalThis.sessionStorage
  const failing = { getItem: key => real.getItem(key), setItem: (key, value) => real.setItem(key, value), removeItem: key => real.removeItem(key), clear: () => real.clear(), ...overrides }
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: failing })
  try { return await run() } finally { Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: real }) }
}
const storageFailure = () => { throw new Error('QuotaExceededError') }
test('quote: storage that cannot be written does not block sending; an unconfirmed result warns and the retry reuses the in-memory request key', async () => {
  const mounted = await mount({ respond: attempt => { if (attempt === 1) throw httpFailure(502) } })
  try {
    await withStorage({ setItem: storageFailure }, async () => {
      await submit(mounted); assert.equal(posts(mounted).length, 1)
      assert.match(mounted.container.textContent, /浏览器无法保存本次提交/)
      await submit(mounted); assert.equal(posts(mounted).length, 2)
      assert.equal(posts(mounted)[1].body.requestKey, posts(mounted)[0].body.requestKey)
      assert.match(mounted.container.textContent, /申请已受理/)
    })
  } finally { await mounted.close() }
})
test('quote: unavailable storage still opens the page and validates locally', async () => {
  sessionStorage.clear()
  await withStorage({ getItem: storageFailure, setItem: storageFailure, removeItem: storageFailure }, async () => {
    const mounted = await mount({ restore: true })
    try {
      await submit(mounted)
      error(mounted.container, '#exhibition', 'request-exhibition-error')
      assert.equal(posts(mounted).length, 0)
    } finally { await mounted.close() }
  })
})
test('quote: a stored draft with an invalid structure is discarded; mistyped form fields are ignored', async () => {
  let mounted = await mount({ draft: { pending: 'broken' } })
  try {
    assert.equal(mounted.container.querySelector('#exhibition').value, '')
    assert.equal(sessionStorage.getItem(draftKey(false)), null)
    assert.equal(mounted.container.querySelector('fieldset').disabled, false)
  } finally { await mounted.close() }
  mounted = await mount({ form: { amount: 30000, scopeCodes: 'materials' } })
  try {
    assert.equal(mounted.container.querySelector('#exhibition').value, validForm.exhibitionName)
    assert.equal(mounted.container.querySelector('#budget').value, '')
    await submit(mounted); assert.equal(posts(mounted).length, 0)
    error(mounted.container, '#budget', 'request-budget-error')
  } finally { await mounted.close() }
})
test('quote: while an anonymous submission is unconfirmed, login is replaced by a hint until the result is confirmed', async () => {
  localStorage.setItem('booth-ai:cs-visitor', '1')
  const mounted = await mount({ auth: { isLoggedIn: false, currentUser: null }, draft: { owner: null }, respond: attempt => { if (attempt === 1) throw httpFailure(502) } })
  try {
    assert.ok(buttonByText(mounted.container, '已有账号？先登录'))
    await submit(mounted)
    assert.match(mounted.container.textContent, /暂未确认受理结果/)
    assert.equal(buttonByText(mounted.container, '已有账号？先登录'), undefined)
    assert.match(mounted.container.textContent, /请先用上方按钮确认本次申请的受理结果/)
    await submit(mounted); assert.equal(posts(mounted).length, 2)
    assert.equal(posts(mounted)[1].body.requestKey, posts(mounted)[0].body.requestKey)
    assert.match(mounted.container.textContent, /申请已受理/)
  } finally { await mounted.close(); localStorage.removeItem('booth-ai:cs-visitor') }
})
test('quote: after logging in, an unconfirmed anonymous submission is neither restored nor resent; the user is pointed to My projects', async () => {
  const mounted = await mount({ draft: { owner: null, pending: { requestKey: 'guest-key', schemeCode: 'SC-6030' } } })
  try {
    assert.match(mounted.container.textContent, /您登录前提交的申请尚未确认受理结果/)
    assert.ok([...mounted.container.querySelectorAll('a')].some(link => link.getAttribute('href') === '/my-projects'))
    assert.equal(mounted.container.querySelector('#exhibition').value, '')
    assert.equal(mounted.container.querySelector('fieldset').disabled, false)
    assert.equal(posts(mounted).length, 0)
  } finally { await mounted.close() }
})
test('quote: a failed context read offers an in-page retry and keeps the form', async () => {
  const mounted = await mount({ context: attempt => { if (attempt === 1) throw new Error('network down') } })
  try {
    assert.match(mounted.container.textContent, /方案资料读取失败/)
    assert.equal(submitButton(mounted.container).disabled, true)
    buttonByText(mounted.container, '重新读取方案资料').click(); await settle()
    assert.doesNotMatch(mounted.container.textContent, /方案资料读取失败/)
    assert.equal(buttonByText(mounted.container, '重新读取方案资料'), undefined)
    assert.equal(mounted.container.querySelector('#exhibition').value, validForm.exhibitionName)
    await submit(mounted); assert.equal(posts(mounted).length, 1)
    assert.match(mounted.container.textContent, /申请已受理/)
  } finally { await mounted.close() }
})
for (const scenario of [
  { name: 'an unavailable scheme', options: { context: () => { throw httpFailure(409, 'SCHEME_UNAVAILABLE') } }, message: /方案或选定效果已变化/ },
  { name: 'a theme job that no longer exists', options: { query: '?themeJobId=theme-missing', failures: { '/api/v1/client/theme-jobs/theme-missing': httpFailure(404) } }, message: /主题结果不可用/ },
]) {
  test(`quote: ${scenario.name} shows its own reason without a pointless retry`, async () => {
    const mounted = await mount(scenario.options)
    try {
      assert.match(mounted.container.textContent, scenario.message)
      assert.doesNotMatch(mounted.container.textContent, /方案资料读取失败/)
      assert.equal(buttonByText(mounted.container, '重新读取方案资料'), undefined)
      assert.equal(submitButton(mounted.container).disabled, true)
    } finally { await mounted.close() }
  })
}
test('quote: a complete four-side artwork is shown as attached, not as pending', async () => {
  const artworkJob = { jobId: 'artwork-1', deliveryStatus: 'ready', schemeCode: 'SC-6030', themeSelection: { themeJobId: 'theme-1', resultId: 'result-1', selectionRevision: 2 } }
  let mounted = await mount({ themeJob: themeJob(null), artworkJob, query: '?themeJobId=theme-1&artworkJobId=artwork-1' })
  try {
    assert.match(mounted.container.textContent, /已附带您生成的完整四面素材/)
    assert.doesNotMatch(mounted.container.textContent, /主题平面素材尚待补充/)
    await submit(mounted); assert.equal(posts(mounted)[0].body.artworkJobId, 'artwork-1')
  } finally { await mounted.close() }
  mounted = await mount({ themeJob: themeJob(null), query: '?themeJobId=theme-1' })
  try {
    assert.match(mounted.container.textContent, /主题平面素材尚待补充/)
    assert.doesNotMatch(mounted.container.textContent, /已附带您生成的完整四面素材/)
  } finally { await mounted.close() }
})
for (const scenario of [
  { name: 'zero budget', form: { amount: '0' }, field: '#budget', errorId: 'request-budget-error', fix: '30000.5', message: '请填写大于 0 的材料预算，最多 6 位小数。' },
  { name: 'blank exhibition name', form: { exhibitionName: '   ' }, field: '#exhibition', errorId: 'request-exhibition-error', fix: '上海测试展', message: '请填写展会名称。' },
  { name: 'blank contact name', form: { contactName: ' ' }, field: '#contact', errorId: 'request-contact-name-error', fix: '王测试', message: '请填写联系人。' },
  { name: 'company without a name', form: { customerType: 'company', company: ' ' }, field: '#company', errorId: 'request-company-error', fix: '示例公司', message: '客户类型为企业时，请填写企业名称。' },
  { name: 'invalid phone', form: { phone: 'call me' }, field: '#phone', errorId: 'request-contact-error', fix: '+86 (21) 5555-0000', message: '电话格式不正确，请填写 7–15 位数字，可包含 +、空格、括号或短横线。' },
  { name: 'invalid email', form: { email: 'not-an-email' }, field: '#email', errorId: 'request-contact-error', fix: 'test@example.com', message: '邮箱格式不正确。' },
  { name: 'missing city', form: { city: '' }, field: '#city', errorId: 'request-city-error', message: '请选择城市。' },
]) {
  test(`quote: ${scenario.name} is blocked locally with a focused field error`, async () => {
    const mounted = await mount({ form: scenario.form })
    try {
      await submit(mounted)
      const field = error(mounted.container, scenario.field, scenario.errorId)
      assertSameNode(document.activeElement, field, 'document.activeElement vs field')
      assert.equal(mounted.container.querySelector(`#${scenario.errorId}`).textContent, scenario.message)
      assert.equal(posts(mounted).length, 0)
      if (!scenario.fix) return
      input(mounted.container, scenario.field, scenario.fix); await settle()
      assertNoNode(mounted.container.querySelector(`#${scenario.errorId}`), 'field error after repair')
      await submit(mounted); assert.equal(posts(mounted).length, 1)
    } finally { await mounted.close() }
  })
}
async function choose(container, selector, label) {
  container.querySelector(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await nextTick(); await nextTick()
  const target = [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.trim() === label)
  assert.ok(target, `Option not found: ${label}`)
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 0)); await settle()
}
test('quote: failed country and city lists can be reloaded in place', async () => {
  const reads = { countries: 0, cities: 0 }
  const mounted = await mount({ dictionary: async path => {
    const kind = path.endsWith('queryCountries') ? 'countries' : 'cities'
    if (++reads[kind] === 1) throw new Error('timeout')
    return { data: kind === 'countries' ? [{ dictKey: 'CN', dictValue: '中国' }] : [{ dictKey: 'SH', dictValue: '上海' }] }
  } })
  try {
    assert.match(mounted.container.textContent, /国家列表加载失败/)
    assert.match(mounted.container.textContent, /城市列表加载失败/)
    for (const retry of [...mounted.container.querySelectorAll('button')].filter(button => button.textContent.trim() === '重新加载')) retry.click()
    await settle()
    assert.doesNotMatch(mounted.container.textContent, /列表加载失败/)
    assert.deepEqual(reads, { countries: 2, cities: 2 })
    await submit(mounted); assert.equal(posts(mounted).length, 1)
  } finally { await mounted.close() }
})
test('quote: switching country discards the late city response of the previous country', async () => {
  let releaseChina
  const mounted = await mount({ dictionary: async (path, options) => {
    if (path.endsWith('queryCountries')) return { data: [{ dictKey: 'CN', dictValue: '中国' }, { dictKey: 'US', dictValue: '美国' }] }
    if (options.query.countryCode === 'CN') return new Promise(resolve => { releaseChina = () => resolve({ data: [{ dictKey: 'SH', dictValue: '上海' }] }) })
    return { data: [{ dictKey: 'NY', dictValue: 'New York' }] }
  } })
  try {
    await choose(mounted.container, '#country', 'US · 美国')
    releaseChina(); await settle()
    assert.equal(mounted.container.querySelector('#city').disabled, false)
    await choose(mounted.container, '#city', 'New York')
    await submit(mounted); assert.equal(posts(mounted).length, 1)
    assert.equal(posts(mounted)[0].body.exhibition.countryCode, 'US')
    assert.equal(posts(mounted)[0].body.exhibition.city, 'New York')
  } finally { await mounted.close() }
})
