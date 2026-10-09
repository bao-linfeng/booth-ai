import type { RouteLocationNormalizedLoaded } from 'vue-router'

/**
 * 这些页面只在创建时读取路由参数（方案编号、任务编号、来源检索）。同一路由内参数变化时组件会被复用，
 * 地址已是新对象而页面仍操作旧对象，所以按业务身份重建组件；其余 query（如 cs=open、bomRevision）变化不重建。
 */
const identityQuery: Record<string, string[]> = {
  SchemeDetail: ['searchId'],
  SchemeTheme: ['searchId'],
  ThemeJob: [],
  QuoteRequest: ['themeJobId', 'artworkJobId', 'searchId'],
}

export function pageKey(route: RouteLocationNormalizedLoaded): string | undefined {
  const name = typeof route.name === 'string' ? route.name : ''
  const query = identityQuery[name]
  if (!query) return undefined
  return JSON.stringify([name, route.params, query.map(key => route.query[key] ?? null)])
}
