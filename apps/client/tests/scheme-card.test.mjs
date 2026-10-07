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
for (const name of ['window', 'document', 'navigator', 'history', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name] })
}
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
    name: 'test-client-sfc', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:test-vue') return '\0test-vue' },
    load(id) { if (id === '\0test-vue') return "export { createApp, h, nextTick } from 'vue'; export { createRouter, createMemoryHistory } from 'vue-router'" },
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
after(async () => { await server.close(); await window.happyDOM.close() })
const { createApp, h, nextTick, createRouter, createMemoryHistory } = await server.ssrLoadModule('virtual:test-vue')
const { default: SchemeCard } = await server.ssrLoadModule('/src/features/selection/SchemeCard.vue')
const { Translation } = await server.ssrLoadModule('vue-i18n')

const item = {
  code: 'SC-6030', matchType: 'direct',
  images: [
    { assetId: 'front', url: 'front.jpg', thumbnailUrl: 'front-thumb.jpg', order: 0, width: 1600, height: 1200 },
    { assetId: 'side', url: 'side.jpg', thumbnailUrl: 'side-thumb.jpg', order: 1, width: 1600, height: 1200 },
  ],
  specifications: { lengthMm: 6000, widthMm: 3000, heightMm: 4500, areaM2: 18, openingCount: 2, productSystemId: 'system-a', productSystemLabel: '标准模块' },
  reasons: ['尺寸满足需求', '开口数量匹配', '标准资料完整', '第四条较次要理由'],
  differences: [{ field: 'openingCount', requested: '3 面', actual: '2 面', reason: '方案库中最接近的已发布方案' }],
  pendingConfirmations: [{ type: 'missing_field', field: '场馆限高', message: '需补充场馆限高' }],
  preferenceMisses: ['未指定色彩偏好'],
}

function mount({ preview = true } = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(SchemeCard, { item, index: 0, preview }) })
  app.component('i18n-t', Translation)
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] }))
  app.mount(container)
  return { app, container, close: () => { app.unmount(); container.remove() } }
}

test('SchemeCard prioritizes artwork, facts, and collapsed secondary reasons', async () => {
  const mounted = mount()
  try {
    assert.match(mounted.container.textContent, /标准模块展台/)
    assert.match(mounted.container.textContent, /为什么适合您/)
    assert.match(mounted.container.textContent, /尺寸满足需求/)
    assert.match(mounted.container.textContent, /需要确认的差异/)
    const expand = [...mounted.container.querySelectorAll('button')].find(button => button.textContent.includes('展开其余'))
    assert.ok(expand)
    const remainingReasons = document.getElementById(expand.getAttribute('aria-controls'))
    assert.ok(remainingReasons)
    assert.match(remainingReasons.textContent, /第四条较次要理由/)
    assert.equal(expand.getAttribute('aria-expanded'), 'false')
    assert.equal(getComputedStyle(remainingReasons).display, 'none')
    expand.click()
    await nextTick()
    assert.equal(expand.getAttribute('aria-expanded'), 'true')
    assert.notEqual(getComputedStyle(remainingReasons).display, 'none')
    assert.match(expand.textContent, /收起匹配理由/)
  } finally { mounted.close() }
})

test('SchemeCard shows pending confirmations and keeps the multi-view gallery available', async () => {
  const mounted = mount({ preview: false })
  try {
    assert.match(mounted.container.textContent, /需补充场馆限高/)
    const view = [...mounted.container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '查看第 2 张')
    assert.ok(view)
    view.click()
    await nextTick()
    assert.equal(view.getAttribute('aria-pressed'), 'true')
    assert.match(view.textContent, /当前视角/)
    assert.doesNotMatch(mounted.container.querySelector('[aria-label="查看第 1 张"]').textContent, /当前视角/)
  } finally { mounted.close() }
})

test('gallery preview closes with Escape and restores the originating artwork button', async () => {
  const mounted = mount()
  try {
    const trigger = mounted.container.querySelector('[aria-label="放大 SC-6030 第 1 张图片"]')
    trigger.focus()
    trigger.click()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 50))
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 50))
    assertNoNode(document.querySelector('[role="dialog"]'), "document.querySelector('[role=\"dialog\"]')")
    assertSameNode(document.activeElement, trigger, "document.activeElement vs trigger")
  } finally { mounted.close() }
})
