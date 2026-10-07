import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { assertNoNode, assertSameNode, assertNotSameNode } from './dom-assert.mjs'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'history', 'localStorage', 'sessionStorage', 'Storage', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
const downloads = []
window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, filename: this.download }) }
registerTS(() => ts)
const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({
  root, configFile: false, server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      'vue-i18n': fileURLToPath(new URL('./mock-i18n.ts', import.meta.url)),
    },
  },
  plugins: [{
    name: 'test-scheme-detail',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:test-vue') return '\0test-vue'
      if (id.endsWith('/features/selection/SelectionShell.vue') || id.endsWith('/layouts/MainLayout.vue')) return '\0test-shell'
      if (['/lib/api-client', '/services/api/bom', '/services/api/scheme-assets'].some(path => id.replaceAll('\\', '/').replace(/\.ts$/, '').endsWith(path))) return '\0test-api'
    },
    load(id) {
      if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'"
      if (id === '\0test-shell') return "import { h } from 'vue'; export default { setup(_, { slots }) { return () => h('div', slots.default?.()) } }"
      if (id === '\0test-api') return ['apiFetch', 'getClientBom', 'downloadClientBom', 'getClientBomApi', 'downloadClientBomApi', 'getSchemeDeliverables', 'getSchemeDownload', 'downloadSchemeArchive'].map(name => {
        const prop = name.endsWith('Api') ? name : name + 'Api'
        if (name.startsWith('downloadClientBom')) {
          return `export const ${name} = async (...args) => {
            const fn = globalThis.__schemeDetailApi.${name} || globalThis.__schemeDetailApi.${prop};
            const res = await fn(...args);
            if (res && res.status >= 400) {
              const data = await res.json().catch(() => ({}));
              throw { status: res.status, data, response: res };
            }
            return res;
          }`
        }
        return `export const ${name} = (...args) => (globalThis.__schemeDetailApi.${name} || globalThis.__schemeDetailApi.${prop})(...args)`
      }).join('\n')
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
after(async () => { delete globalThis.__schemeDetailApi; await server.close(); await window.happyDOM.close() })
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: SchemeDetail } = await server.ssrLoadModule('/src/pages/SchemeDetail.vue')

const detail = {
  code: 'SC-6030',
  images: [{ assetId: 'front', url: 'https://assets.example/front.jpg', thumbnailUrl: 'https://assets.example/front-thumb.jpg', order: 0, width: 1600, height: 1200 }],
  specifications: { lengthMm: 6000, widthMm: 3000, heightMm: 4500, areaM2: 18, openingCount: 2, productSystemId: 'system-a', productSystemLabel: '标准模块' },
  resources: { model: true, bom: true, renderings: true, masks: true, drawings: true, artworks: true },
  actions: { theme: 'available', quote: 'available', bom: 'available', drawings: 'available', artworks: 'available', modelDownload: 'available' },
}
const bom = revision => ({
  schemeCode: detail.code, revision, status: 'verified', verifiedAt: '2026-10-04T00:00:00Z',
  items: [{ id: 'row-1', ordinal: 1, productName: '铝框立柱', productModel: 'FS62', specificationMm: '3000', quantity: '6', sourceUnit: '根', erpCode: 'ERP-01', totalWeightKg: '12.5', measurementKind: 'count' }],
})
const asset = { assetId: 'drawing-1', name: '正视图', originalFilename: 'SC-6030 正视图.png', mimeType: 'image/png', byteSize: 1024, sortOrder: 0 }
const assetLink = (filename = asset.originalFilename) => ({ downloadUrl: 'https://assets.example/drawing.png', filename, mimeType: 'image/png', expiresAt: '2026-10-04T01:00:00Z' })

async function settle() {
  for (let i = 0; i < 4; i++) { await nextTick(); await new Promise(resolve => setTimeout(resolve, 10)) }
}

async function mount({ path = '/schemes/SC-6030?searchId=search-42', api = {} } = {}) {
  const calls = []
  const handlers = {
    apiFetch: async () => ({ code: 0, data: detail }),
    getClientBomApi: async () => bom(7),
    downloadClientBomApi: async () => { throw new Error('Unexpected BOM download') },
    getSchemeDeliverables: async () => ({ schemeCode: detail.code, revision: 'assets-r1', items: [asset] }),
    getSchemeDownload: async () => assetLink(),
    downloadSchemeArchive: async () => { throw new Error('Unexpected archive download') },
    ...api,
  }
  globalThis.__schemeDetailApi = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (...args) => { calls.push({ name, args }); return handler(...args) }]))
  downloads.length = 0
  const container = document.createElement('div')
  document.body.append(container)
  const router = createRouter({ history: createMemoryHistory(), routes: ['/schemes/:code', '/ai-selection/preview/schemes/:code', '/:pathMatch(.*)*'].map(path => ({ path, component: { render: () => null } })) })
  await router.push(path)
  await router.isReady()
  const app = createApp({ render: () => h(SchemeDetail) })
  app.use(router)
  app.mount(container)
  await settle()
  return { container, router, calls, close: async () => { app.unmount(); container.remove(); await settle() } }
}

function button(container, text) {
  const found = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === text || (text === 'Close' && el.textContent.trim() === '关闭') || el.getAttribute('aria-label') === text)
  assert.ok(found, `Button not found: ${text}`)
  return found
}

async function selectTab(container, text) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(el => el.textContent.trim() === text)
  assert.ok(tab, `Tab not found: ${text}`)
  tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
  assert.equal(tab.getAttribute('aria-selected'), 'true')
}

function quoteQueries(mounted) {
  const links = [...mounted.container.querySelectorAll('a')].filter(el => el.textContent.trim() === '申请报价')
  assert.equal(links.length, 2)
  assert.equal(links[0].getAttribute('href'), links[1].getAttribute('href'))
  return links.map(link => {
    const url = new URL(link.href)
    assert.equal(url.pathname, '/schemes/SC-6030/quote')
    return Object.fromEntries(url.searchParams)
  })
}

test('detail presents facts and quote before optional theme; quote links track lazy BOM; quote and theme keep searchId', async () => {
  const mounted = await mount()
  try {
    assert.equal(mounted.container.querySelector('h1').textContent, '6 × 3 m · 标准模块展台')
    const header = mounted.container.querySelector('header').textContent
    for (const fact of ['方案编号 SC-6030', '18 ㎡', '2 面开口', '实际高度 4.5 m']) assert.ok(header.includes(fact))
    const aside = mounted.container.querySelector('aside')
    const actions = [...aside.querySelectorAll('a')]
    assert.deepEqual(actions.map(el => el.textContent.trim()), ['申请报价', 'AI 换主题'])
    assert.deepEqual(quoteQueries(mounted), [{ entryPoint: 'scheme_detail', searchId: 'search-42' }, { entryPoint: 'scheme_detail', searchId: 'search-42' }])
    for (const link of [...mounted.container.querySelectorAll('a')].filter(el => el.textContent.trim() === 'AI 换主题')) {
      const url = new URL(link.href)
      assert.equal(url.pathname, '/schemes/SC-6030/theme')
      assert.equal(url.searchParams.get('searchId'), 'search-42')
    }
    assert.deepEqual(mounted.calls, [{ name: 'apiFetch', args: ['/api/v1/client/schemes/SC-6030'] }])
    await selectTab(mounted.container, '图纸与素材')
    assert.equal(mounted.calls.filter(call => call.name === 'getClientBomApi').length, 0)
    await selectTab(mounted.container, '物料清单')
    assert.deepEqual(mounted.calls.filter(call => call.name === 'getClientBomApi'), [{ name: 'getClientBomApi', args: ['SC-6030'] }])
    assert.match(mounted.container.textContent, /铝框立柱/)
    const region = mounted.container.querySelector('[role="region"][aria-label="物料明细，可横向滚动"]')
    assert.equal(region.getAttribute('tabindex'), '0')
    assert.ok(region.querySelector('table caption'))
    assert.deepEqual(quoteQueries(mounted), Array(2).fill({ entryPoint: 'bill_of_materials', bomRevision: '7', searchId: 'search-42' }))
    await selectTab(mounted.container, '方案说明')
    assert.deepEqual(quoteQueries(mounted), Array(2).fill({ entryPoint: 'scheme_detail', bomRevision: '7', searchId: 'search-42' }))
    await selectTab(mounted.container, '物料清单')
    assert.equal(mounted.calls.filter(call => call.name === 'getClientBomApi').length, 1)
  } finally { await mounted.close() }
})

test('resource filenames, real Dialog preview, Escape/close, and trigger focus restoration', async () => {
  const mounted = await mount()
  try {
    await selectTab(mounted.container, '图纸与素材')
    button(mounted.container, '三视图').click()
    await settle()
    assert.deepEqual(mounted.calls.filter(call => call.name === 'getSchemeDeliverables'), [{ name: 'getSchemeDeliverables', args: ['SC-6030', 'drawings'] }])
    const article = mounted.container.querySelector('article')
    assert.match(article.textContent, /SC-6030 正视图\.png/)
    const trigger = article.querySelector('[aria-label="预览 SC-6030 正视图.png"]')
    assert.ok(article.querySelector('[aria-label="下载 SC-6030 正视图.png"]'))
    for (const closeBy of ['escape', 'button']) {
      trigger.focus()
      trigger.click()
      await settle()
      const dialog = document.querySelector('[role="dialog"]')
      assert.ok(dialog)
      assert.match(dialog.textContent, /SC-6030 正视图\.png/)
      assert.equal(dialog.querySelector('img').getAttribute('src'), assetLink().downloadUrl)
      assert.deepEqual(mounted.calls.filter(call => call.name === 'getSchemeDownload').at(-1).args, ['SC-6030', 'drawings', 'drawing-1', true])
      if (closeBy === 'escape') dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else button(dialog, 'Close').click()
      await settle()
      assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
      assertSameNode(document.activeElement, trigger, "document.activeElement vs trigger")
    }
    article.querySelector('[aria-label="下载 SC-6030 正视图.png"]').click()
    await settle()
    assert.deepEqual(mounted.calls.filter(call => call.name === 'getSchemeDownload').at(-1).args, ['SC-6030', 'drawings', 'drawing-1'])
    assert.deepEqual(downloads, [{ href: assetLink().downloadUrl, filename: asset.originalFilename }])
  } finally { await mounted.close() }
})

test('PDF preview uses a safe new-tab link without an iframe; Escape restores the resource trigger', async () => {
  const pdf = { ...asset, mimeType: 'application/pdf', originalFilename: 'SC-6030 三视图.pdf' }
  const link = { ...assetLink(pdf.originalFilename), downloadUrl: 'https://assets.example/drawing.pdf?signature=test-only&inline=true', mimeType: pdf.mimeType }
  const mounted = await mount({ api: {
    getSchemeDeliverables: async () => ({ schemeCode: detail.code, revision: 'assets-r1', items: [pdf] }),
    getSchemeDownload: async () => link,
  } })
  try {
    await selectTab(mounted.container, '图纸与素材')
    button(mounted.container, '三视图').click(); await settle()
    const trigger = mounted.container.querySelector('[aria-label="预览 SC-6030 三视图.pdf"]')
    trigger.focus(); trigger.click(); await settle()
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog); assertNoNode(dialog.querySelector('iframe, embed, object'), "dialog.querySelector('iframe, embed, object')")
    assert.match(dialog.textContent, /PDF 原件将在新标签页中打开/)
    const anchor = dialog.querySelector('a')
    assert.equal(anchor.href, link.downloadUrl)
    assert.equal(anchor.target, '_blank')
    assert.deepEqual(anchor.rel.split(/\s+/).sort(), ['noopener', 'noreferrer'])
    assert.equal(anchor.hasAttribute('download'), false)
    assert.deepEqual(mounted.calls.filter(call => call.name === 'getSchemeDownload').at(-1).args, ['SC-6030', 'drawings', 'drawing-1', true])
    anchor.focus()
    anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assertSameNode(document.activeElement, trigger, "document.activeElement vs trigger")
    assert.deepEqual(downloads, [])
  } finally { await mounted.close() }
})

test('archive revision invalidation refreshes files and requires another user download with the new revision', async () => {
  let listing = 0
  const refreshed = { ...asset, assetId: 'drawing-2', originalFilename: 'SC-6030 正视图修订版.png' }
  const mounted = await mount({ api: {
    getSchemeDeliverables: async () => ({ schemeCode: detail.code, revision: ++listing === 1 ? 'assets-r1' : 'assets-r2', items: listing === 1 ? [asset] : [refreshed] }),
    downloadSchemeArchive: async () => { throw { data: new Blob([JSON.stringify({ error: { reason: 'DELIVERABLE_REVISION_CHANGED' } })], { type: 'application/json' }) } },
  } })
  try {
    await selectTab(mounted.container, '图纸与素材')
    button(mounted.container, '三视图').click()
    await settle()
    button(mounted.container, '下载全部').click()
    await settle()
    assert.equal(listing, 2)
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /资料已更新，请确认刷新后的列表，再重新下载/)
    assert.match(mounted.container.querySelector('article').textContent, /SC-6030 正视图修订版\.png/)
    assertNoNode(mounted.container.querySelector('[aria-label="预览 SC-6030 正视图.png"]'), "mounted.container.querySelector('[aria-label=\"预览 SC-6030 正视图.png\"]')")
    assert.equal(downloads.length, 0)
    assert.deepEqual(mounted.calls.filter(call => call.name === 'downloadSchemeArchive').map(call => call.args), [['SC-6030', 'drawings', 'assets-r1']])
    button(mounted.container, '下载全部').click()
    await settle()
    assert.deepEqual(mounted.calls.filter(call => call.name === 'downloadSchemeArchive').map(call => call.args), [['SC-6030', 'drawings', 'assets-r1'], ['SC-6030', 'drawings', 'assets-r2']])
  } finally { await mounted.close() }
})

test('a pending resource preview cannot open a Dialog after leaving the resources tab', async () => {
  const pdf = { ...asset, mimeType: 'application/pdf', originalFilename: 'SC-6030 正视图.pdf' }
  let resolvePreview
  const pendingPreview = new Promise(resolve => { resolvePreview = resolve })
  const mounted = await mount({ api: {
    getSchemeDeliverables: async () => ({ schemeCode: detail.code, revision: 'assets-r1', items: [pdf] }),
    getSchemeDownload: () => pendingPreview,
  } })
  try {
    await selectTab(mounted.container, '图纸与素材')
    button(mounted.container, '三视图').click()
    await settle()
    const trigger = mounted.container.querySelector('[aria-label="预览 SC-6030 正视图.pdf"]')
    trigger.focus()
    trigger.click()
    await settle()
    assert.equal(trigger.getAttribute('aria-busy'), 'true')
    await selectTab(mounted.container, '方案说明')
    assert.equal(trigger.isConnected, false)
    const activeBeforeResponse = document.activeElement
    resolvePreview({ ...assetLink(pdf.originalFilename), mimeType: 'application/pdf' })
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog) {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await settle()
      assertNotSameNode(document.activeElement, trigger, 'Focus must not return to an unmounted resource button')
    }
    assert.equal(dialog, null, 'A late preview response must not open a Dialog outside the resources tab')
    assertSameNode(document.activeElement, activeBeforeResponse, "document.activeElement vs activeBeforeResponse")
  } finally { await mounted.close() }
})

test('preview permits theme exploration but neither quotes nor BOM/resource downloads or API requests', async () => {
  const mounted = await mount({ path: '/ai-selection/preview/schemes/DEMO_63_001?searchId=ignored' })
  try {
    assert.match(mounted.container.textContent, /静态示例 · 非已发布方案/)
    assertNoNode(mounted.container.querySelector('a[href*="/quote"]'), "mounted.container.querySelector('a[href*=\"/quote\"]')")
    assert.equal(button(mounted.container, '示例方案不可申请报价').disabled, true)
    assert.equal(button(mounted.container, '示例不可报价').disabled, true)
    for (const link of [...mounted.container.querySelectorAll('a')].filter(el => el.textContent.trim() === 'AI 换主题')) assert.equal(link.getAttribute('href'), '/ai-selection/preview/schemes/DEMO_63_001/theme')
    await selectTab(mounted.container, '物料清单')
    assert.match(mounted.container.textContent, /静态示例不提供真实物料清单/)
    assert.equal([...mounted.container.querySelectorAll('button')].some(el => el.textContent.includes('下载 XLSX')), false)
    await selectTab(mounted.container, '图纸与素材')
    for (const text of ['三视图', '标准平面素材', '下载 SKP 模型']) {
      const disabled = button(mounted.container, text)
      assert.equal(disabled.disabled, true)
      disabled.click()
    }
    await settle()
    assert.deepEqual(mounted.calls, [])
    assert.deepEqual(downloads, [])
  } finally { await mounted.close() }
})

test('unavailable BOM (409) shows empty state without a download or revision in quote links', async () => {
  const mounted = await mount({ api: { getClientBomApi: async () => { throw { response: { status: 409 } } } } })
  try {
    await selectTab(mounted.container, '物料清单')
    assert.match(mounted.container.textContent, /当前方案暂无可用清单/)
    assert.equal([...mounted.container.querySelectorAll('button')].some(el => el.textContent.includes('下载 XLSX')), false)
    assert.deepEqual(quoteQueries(mounted), Array(2).fill({ entryPoint: 'bill_of_materials', searchId: 'search-42' }))
  } finally { await mounted.close() }
})

test('BOM load errors retry; stale XLSX displays refresh status and quote revisions update after refresh', async () => {
  let attempts = 0
  const mounted = await mount({ api: {
    getClientBomApi: async () => { if (++attempts === 1) throw new Error('Controlled failure'); return bom(attempts === 2 ? 7 : 8) },
    downloadClientBomApi: async () => new Response(JSON.stringify({ error: { reason: 'BOM_REVISION_CHANGED' } }), { status: 409, headers: { 'content-type': 'application/json' } }),
  } })
  try {
    await selectTab(mounted.container, '物料清单')
    assert.match(mounted.container.textContent, /加载失败/)
    button(mounted.container, '重试').click()
    await settle()
    assert.equal(attempts, 2)
    assert.match(mounted.container.textContent, /铝框立柱/)
    button(mounted.container, '下载 XLSX').click()
    await settle()
    assert.deepEqual(mounted.calls.filter(call => call.name === 'downloadClientBomApi'), [{ name: 'downloadClientBomApi', args: ['SC-6030', 7] }])
    assert.match(mounted.container.querySelector('[role="status"]').textContent, /清单已更新，请刷新后重新下载/)
    assert.equal(attempts, 2)
    assert.equal(downloads.length, 0)
    button(mounted.container, '刷新清单').click()
    await settle()
    assert.equal(attempts, 3)
    assert.match(mounted.container.textContent, /修订\s*8/)
    assert.deepEqual(quoteQueries(mounted), Array(2).fill({ entryPoint: 'bill_of_materials', bomRevision: '8', searchId: 'search-42' }))
  } finally { await mounted.close() }
})
