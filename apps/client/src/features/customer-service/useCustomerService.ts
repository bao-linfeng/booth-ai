import { reactive, shallowRef } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
  errorReason, getCurrentConversation, listMessages, markRead as markReadApi, openConversation, postContext, postMessage,
  type ContextDto, type ContextInput, type ConversationDto, type CustomerEvent, type EntryPoint, type MessageDto,
} from '@/services/api/customer-service'
import { applyTranslation, maxSeq, mergeMessages, minSeq, readTargets } from './timeline'
import { useCustomerServiceConnection, type ConnectionState } from './useCustomerServiceConnection'
import { clearVisitor, ensureVisitor, hasVisitor, mergeVisitorAfterLogin } from './visitor'

export interface PendingMessage { clientMessageId: string; body: string; kind: 'text' | 'offline'; contactEmail?: string; status: 'sending' | 'failed' }

/**
 * 在线客服全局状态（不持久化）。用模块级响应式单例而不是 Pinia store：
 * 入口分散在多个页面，页面测试不安装 Pinia，单例可直接在测试中驱动。
 */
const state = reactive({
  open: false,
  conversation: null as ConversationDto | null,
  contexts: [] as ContextDto[],
  messages: [] as MessageDto[],
  pending: [] as PendingMessage[],
  hasMore: false,
  loaded: false,
  agentsOnline: false,
  connection: 'idle' as ConnectionState,
  unreadCount: 0,
  /** 一次性提示：contextUnavailable（上下文不可用）/ openFailed / rateLimited（发送太频繁） */
  notice: '' as '' | 'contextUnavailable' | 'openFailed' | 'rateLimited',
  busy: false,
})
/** 当前页面可一键发给客服的上下文（方案详情页登记方案、项目详情页登记项目），离开时清除；不随会话状态重置 */
/** label：按钮提示里显示的方案编号或项目编号 */
export interface PageContext { context: ContextInput; entryPoint: EntryPoint; label: string }
const pageContext = shallowRef<PageContext | null>(null)
const readSeqs = new Map<string, number>()
let idleTimer: ReturnType<typeof setInterval> | undefined
let readTimer: ReturnType<typeof setTimeout> | undefined

function loggedIn() {
  return Boolean(useAuthStore().isLoggedIn)
}

/** 未登录时先确保已签发访客；令牌失效（已合并、已删除、Cookie 丢失）时清除标记后重新签发并重试一次 */
async function withSubject<T>(run: () => Promise<T>): Promise<T> {
  if (loggedIn()) return run()
  await ensureVisitor()
  try {
    return await run()
  } catch (failure) {
    const { status, reason } = errorReason(failure)
    if (status !== 401 || reason !== 'VISITOR_REQUIRED' || loggedIn()) throw failure
    clearVisitor()
    await ensureVisitor()
    return run()
  }
}

const connection = useCustomerServiceConnection({
  after: () => maxSeq(state.messages.filter(message => message.conversationId === state.conversation?.id)),
  onState: value => { state.connection = value },
  onEvent: handleEvent,
  poll: async () => { await fetchNewer(); await refreshCurrent() },
  onReconnected: () => { void refreshCurrent() },
})

function handleEvent(event: CustomerEvent) {
  if (event.type === 'message.created') {
    addMessages([event.message])
  } else if (event.type === 'message.translated') {
    state.messages = applyTranslation(state.messages, event.messageId, event.translation)
  } else if ((event.type === 'conversation.updated' || event.type === 'ready') && event.conversation) {
    if (!state.conversation || event.conversation.id === state.conversation.id) state.conversation = event.conversation
  } else if (event.type === 'read' && state.conversation) {
    state.conversation = { ...state.conversation, agentReadSeq: event.agentReadSeq }
  }
}

function addMessages(messages: MessageDto[]) {
  state.messages = mergeMessages(state.messages, messages)
  const delivered = new Set(messages.map(message => message.clientMessageId).filter(Boolean))
  state.pending = state.pending.filter(item => !delivered.has(item.clientMessageId))
  if (messages.some(message => message.senderType === 'agent')) {
    if (state.open) scheduleMarkRead()
    else state.unreadCount += messages.filter(message => message.senderType === 'agent').length
  }
}

async function fetchNewer() {
  if (!state.loaded) return
  const page = await withSubject(() => listMessages({ after: maxSeq(state.messages), limit: 100 }))
  addMessages(page.items)
}

async function loadLatest() {
  const page = await withSubject(() => listMessages({ limit: 30 }))
  state.messages = mergeMessages([], page.items)
  state.hasMore = page.hasMore
  state.loaded = true
}

export async function loadOlder() {
  const before = minSeq(state.messages)
  if (before === undefined || !state.hasMore) return
  const page = await withSubject(() => listMessages({ before, limit: 30 }))
  state.messages = mergeMessages(state.messages, page.items)
  state.hasMore = page.hasMore
}

/** 读取当前未结束会话、未读数与坐席在线；未结束会话消失说明本轮已结束 */
export async function refreshCurrent() {
  const current = await withSubject(getCurrentConversation)
  state.unreadCount = state.open ? 0 : current.unreadCount
  state.agentsOnline = current.agentsOnline
  if (current.conversation) {
    state.conversation = current.conversation
    state.contexts = current.contexts
  } else if (state.conversation && state.conversation.status !== 'closed') {
    state.conversation = { ...state.conversation, status: 'closed' }
  }
}

function applyOpen(result: { conversation: ConversationDto; contexts: ContextDto[]; agentsOnline: boolean }) {
  state.conversation = result.conversation
  state.contexts = result.contexts
  state.agentsOnline = result.agentsOnline
}

async function openRound(entryPoint: EntryPoint, context?: ContextInput) {
  try {
    applyOpen(await withSubject(() => openConversation(entryPoint, context)))
  } catch (failure) {
    // 上下文不存在或无权使用、或发卡片太频繁时仍打开面板，只是不附带上下文
    const { status, reason } = errorReason(failure)
    if (!context || (status !== 429 && reason !== 'CONTEXT_NOT_FOUND')) throw failure
    state.notice = status === 429 ? 'rateLimited' : 'contextUnavailable'
    applyOpen(await withSubject(() => openConversation(entryPoint)))
  }
}

/** 打开面板：复用未结束会话，带上下文时每次都追加一张卡片；绝不会创建项目 */
export async function openWith(context: ContextInput | undefined, entryPoint: EntryPoint) {
  state.open = true
  state.notice = ''
  state.busy = true
  try {
    await openRound(entryPoint, context)
    if (!state.loaded) await loadLatest()
    else await fetchNewer()
    connection.open(state.conversation!.id)
    await markRead()
  } catch {
    state.notice = 'openFailed'
  } finally {
    state.busy = false
  }
}

export function setPageContext(value: PageContext | null) {
  pageContext.value = value
}

/** 用户手动把当前页面的方案或项目作为卡片发到会话，可重复发送；会话已结束时先开启新一轮再发 */
export async function sendPageContext() {
  const current = pageContext.value
  if (!current || state.busy) return false
  const post = () => withSubject(() => postContext(state.conversation!.id, current.entryPoint, current.context))
  state.notice = ''
  state.busy = true
  try {
    if (!state.conversation || state.conversation.status === 'closed') await openRound('floating')
    let result
    try {
      result = await post()
    } catch (failure) {
      if (errorReason(failure).reason !== 'CONVERSATION_CLOSED') throw failure
      await openRound('floating')
      result = await post()
    }
    connection.open(state.conversation!.id)
    state.conversation = result.conversation
    if (state.loaded) addMessages([result.message])
    else await loadLatest()
    return true
  } catch (failure) {
    const { status, reason } = errorReason(failure)
    state.notice = status === 429 ? 'rateLimited' : reason === 'CONTEXT_NOT_FOUND' ? 'contextUnavailable' : 'openFailed'
    return false
  } finally {
    state.busy = false
  }
}

export function closePanel() {
  state.open = false
  connection.close()
}

function scheduleMarkRead() {
  clearTimeout(readTimer)
  readTimer = setTimeout(() => { void markRead() }, 300)
}

export async function markRead() {
  for (const [conversationId, seq] of readTargets(state.messages)) {
    if (seq <= (readSeqs.get(conversationId) ?? 0)) continue
    try {
      await withSubject(() => markReadApi(conversationId, seq))
      readSeqs.set(conversationId, seq)
    } catch {}
  }
  state.unreadCount = 0
}

async function deliver(item: PendingMessage) {
  item.status = 'sending'
  try {
    const conversationId = state.conversation!.id
    const send = () => postMessage(conversationId, { clientMessageId: item.clientMessageId, body: item.body, kind: item.kind,
      ...(item.contactEmail ? { contactEmail: item.contactEmail } : {}) })
    let result
    try {
      result = await withSubject(send)
    } catch (failure) {
      // 本轮已被结束：开启新一轮后用同一个 clientMessageId 重发（幂等键按会话区分）
      if (errorReason(failure).reason !== 'CONVERSATION_CLOSED') throw failure
      await openRound('floating')
      connection.open(state.conversation!.id)
      result = await withSubject(() => postMessage(state.conversation!.id, { clientMessageId: item.clientMessageId, body: item.body, kind: item.kind,
        ...(item.contactEmail ? { contactEmail: item.contactEmail } : {}) }))
    }
    state.conversation = result.conversation
    addMessages([result.message])
    return true
  } catch {
    item.status = 'failed'
    return false
  }
}

async function enqueue(body: string, kind: 'text' | 'offline', contactEmail?: string) {
  const text = body.trim()
  if (!text) return false
  // 会话已结束时，下一次发送先开启新一轮
  if (!state.conversation || state.conversation.status === 'closed') {
    await openRound('floating')
    connection.open(state.conversation!.id)
  }
  state.pending.push({ clientMessageId: crypto.randomUUID(), body: text, kind, ...(contactEmail ? { contactEmail } : {}), status: 'sending' })
  return deliver(state.pending.at(-1)!)
}

export function send(body: string) {
  return enqueue(body, 'text')
}

export function sendOffline(body: string, contactEmail: string) {
  return enqueue(body, 'offline', contactEmail.trim())
}

export function retry(clientMessageId: string) {
  const item = state.pending.find(pending => pending.clientMessageId === clientMessageId)
  return item ? deliver(item) : Promise.resolve(false)
}

/** 面板关闭时每 60 秒刷新一次未读角标；页面不可见时暂停。没有登录也没有访客令牌时不发请求。 */
export function startIdlePolling() {
  stopIdlePolling()
  const tick = () => {
    if (state.open || document.visibilityState !== 'visible') return
    if (!loggedIn() && !hasVisitor()) return
    void refreshCurrent().catch(() => undefined)
  }
  tick()
  idleTimer = setInterval(tick, 60_000)
}

export function stopIdlePolling() {
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = undefined
}

/** 退出登录或切换账号：断开连接并清空本地会话状态 */
export function resetCustomerService() {
  connection.close()
  readSeqs.clear()
  Object.assign(state, {
    open: false, conversation: null, contexts: [], messages: [], pending: [], hasMore: false, loaded: false,
    agentsOnline: false, unreadCount: 0, notice: '', busy: false,
  })
}

/** 登录成功后：把访客会话合并到账号并重新加载 */
export async function handleCustomerServiceLogin() {
  resetCustomerService()
  await mergeVisitorAfterLogin()
}

export function useCustomerService() {
  return {
    state, pageContext, openWith, closePanel, send, sendOffline, sendPageContext, retry, loadOlder, markRead, refreshCurrent,
    startIdlePolling, stopIdlePolling,
  }
}
