import assert from 'node:assert/strict'

// DOM 节点禁止直接作为 assert 的 actual/expected：断言失败时 node:assert 与 node:test 报告器会以 depth 1000 + getters
// 展开对象，happy-dom 节点会牵出整个 document/window 对象图，曾导致单个测试进程占用 14 GB 内存把机器卡死。
// 节点比较一律先转成布尔值，只把可读说明留在失败信息里。
export function assertNoNode(node, label) {
  assert.equal(node === null || node === undefined, true, `Expected no DOM node: ${label}`)
}

export function assertSameNode(actual, expected, label) {
  assert.equal(actual === expected, true, `Expected the same DOM node: ${label}`)
}

export function assertNotSameNode(actual, expected, label) {
  assert.equal(actual !== expected, true, `Expected a different DOM node: ${label}`)
}
