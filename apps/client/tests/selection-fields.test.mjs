import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { statSync, readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse, compileScript, registerTS } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createServer, transformWithEsbuild } from 'vite'

const window = new Window({ url: 'http://localhost/' })
for (const name of ['window', 'document', 'navigator', 'Document', 'DocumentFragment', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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
    name: 'test-client-sfc',
    resolveId(id) { if (id === 'virtual:test-vue') return '\0test-vue' },
    load(id) { if (id === '\0test-vue') return "export { createApp, h, ref, nextTick } from 'vue'" },
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
const { createApp, h, ref, nextTick } = await server.ssrLoadModule('virtual:test-vue')
const { default: RequirementField } = await server.ssrLoadModule('/src/features/selection/RequirementField.vue')
const { default: RequirementForm } = await server.ssrLoadModule('/src/features/selection/RequirementForm.vue')
const { emptyRequirement } = await server.ssrLoadModule('/src/features/selection/types.ts')
const catalog = {
  dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] },
  boothSpaces: [
    { id: 'a', label: 'a', lengthMm: 6000, widthMm: 3000, heightMm: 3000 },
    { id: 'b', label: 'b', lengthMm: 6000, widthMm: 3000, heightMm: 4500 },
    { id: 'c', label: 'c', lengthMm: 3000, widthMm: 6000, heightMm: 3000 },
  ],
  openingCounts: [], productSystems: [], styles: [], industries: [], budgetTiers: [],
  zones: [], features: [], applicabilityQuestions: [],
}
function mount(component, props = {}, initial = {}) {
  const state = ref({ ...emptyRequirement(), ...initial })
  const emitted = []
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(component, {
    ...props, catalog, modelValue: state.value,
    'onUpdate:modelValue': value => { emitted.push(value); state.value = value },
  }) })
  app.mount(container)
  return { state, emitted, container, close: () => { app.unmount(); container.remove() } }
}
async function input(container, selector, value) {
  const element = container.querySelector(selector)
  assert.ok(element, `Missing input ${selector}`)
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick(); await nextTick()
}
test('RequirementField: metres become millimetres, clearing emits null', async () => {
  for (const field of ['lengthMm', 'widthMm', 'maxHeightMm']) {
    const mounted = mount(RequirementField, { field, id: field })
    try {
      await input(mounted.container, 'input', '3.125')
      assert.equal(mounted.emitted.at(-1)[field], 3125)
      assert.equal(mounted.container.querySelector('input').value, '3.125')
      await input(mounted.container, 'input', '')
      assert.equal(mounted.emitted.at(-1)[field], null)
    } finally { mounted.close() }
  }
})
test('RequirementField: length/width derive area and clearing removes area', async () => {
  for (const [field, other] of [['lengthMm', 'widthMm'], ['widthMm', 'lengthMm']]) {
    const mounted = mount(RequirementField, { field, id: field }, { [other]: 4000 })
    try {
      await input(mounted.container, 'input', '3.125')
      assert.equal(mounted.emitted.at(-1).areaM2, 12.5)
      await input(mounted.container, 'input', '')
      assert.equal(mounted.emitted.at(-1).areaM2, null)
    } finally { mounted.close() }
  }
})
test('RequirementField: invalid precision is accessible and valid precision clears error', async () => {
  const mounted = mount(RequirementField, { field: 'lengthMm', id: 'precision' })
  try {
    await input(mounted.container, 'input', '3.0001')
    const element = mounted.container.querySelector('input')
    assert.equal(element.getAttribute('aria-invalid'), 'true')
    assert.match(document.getElementById(element.getAttribute('aria-describedby')).textContent, /三位小数/)
    await input(mounted.container, 'input', '3.001')
    assert.equal(element.getAttribute('aria-invalid'), 'false')
    assert.equal(element.getAttribute('aria-describedby'), null)
  } finally { mounted.close() }
})
test('RequirementForm: common sizes deduplicate length/width and selection/clear preserve height', async () => {
  const mounted = mount(RequirementForm, {}, { maxHeightMm: 4250 })
  async function open() {
    const trigger = mounted.container.querySelector('[aria-label="方案尺寸"]')
    assert.ok(trigger)
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick(); await nextTick()
    return [...document.querySelectorAll('[role="option"]')]
  }
  try {
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm'), null)
    const more = [...mounted.container.querySelectorAll('button')].find(button => button.textContent.includes('更多条件'))
    assert.ok(more)
    assert.equal(more.getAttribute('aria-expanded'), 'false')
    assert.match(more.textContent, /已填 1 类/)
    more.click()
    await nextTick(); await nextTick()
    await new Promise(resolve => setTimeout(resolve, 30))
    await nextTick()
    assert.equal(more.getAttribute('aria-expanded'), 'true')
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').value, '4.25')
    let options = await open()
    assert.deepEqual(options.map(option => option.textContent.trim()), ['不限', 'a', 'b', 'c'])
    options.find(option => option.textContent.trim() === 'a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick(); await nextTick()
    assert.equal(mounted.emitted.at(-1).boothSpaceId, 'a')
    assert.equal(mounted.emitted.at(-1).lengthMm, 6000)
    assert.equal(mounted.emitted.at(-1).widthMm, 3000)
    assert.equal(mounted.emitted.at(-1).areaM2, 18)
    assert.equal(mounted.emitted.at(-1).maxHeightMm, 4250)
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').value, '4.25')
    assert.match(mounted.container.textContent, /面积 18 ㎡/)
    options = await open()
    options.find(option => option.textContent.trim() === '不限').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick(); await nextTick()
    assert.equal(mounted.emitted.at(-1).boothSpaceId, null)
    assert.equal(mounted.emitted.at(-1).lengthMm, null)
    assert.equal(mounted.emitted.at(-1).widthMm, null)
    assert.equal(mounted.emitted.at(-1).areaM2, null)
    assert.equal(mounted.emitted.at(-1).maxHeightMm, 4250)
    assert.equal(mounted.container.querySelector('#requirement-maxHeightMm').value, '4.25')
  } finally { mounted.close() }
})
