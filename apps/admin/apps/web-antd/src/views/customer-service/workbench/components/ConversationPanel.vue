<script setup lang="ts">
import type {
  AdminMessage,
  ConversationDetail,
  WorkbenchEvent,
} from '#/api/core/customer-service';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';

import { IconifyIcon } from '@vben/icons';
import { useUserStore } from '@vben/stores';
import { formatDateTime } from '@vben/utils';

import {
  Button,
  Empty,
  Image,
  Input,
  Modal,
  Radio,
  Space,
  Tag,
  message as toast,
} from 'ant-design-vue';

import {
  claimConversationApi,
  closeConversationApi,
  CS_LOCALE_LABELS,
  customerLabel,
  eventText,
  listMessagesApi,
  markReadApi,
  postMessageApi,
  releaseConversationApi,
  schemeCardCoverUrl,
  STATUS_LABELS,
} from '#/api/core/customer-service';
import { statusLabels as projectStatusLabels } from '#/api/core/projects';

import {
  fetchAllAfter,
  maxSeq,
  mergeMessages,
  minSeq,
  readTarget,
  translationHint,
  translationOf,
} from '../timeline';

const props = defineProps<{
  canReply: boolean;
  detail: ConversationDetail | null;
  /** 当前会话的最新工作台事件（含递增序号，便于重复事件也能触发） */
  event: null | { event: WorkbenchEvent; version: number };
  supervise: boolean;
}>();
const emit = defineEmits<{ changed: []; transfer: [] }>();
/** 封面加载失败（方案已下架、无效果图或换主题图已不可用）的图片地址，这些卡片改显示图标 */
const brokenCovers = reactive(new Set<string>());

interface Pending {
  body: string;
  clientMessageId: string;
  conversationId: string;
  kind: 'note' | 'text';
  status: 'failed' | 'sending';
}

const userStore = useUserStore();
const messages = ref<AdminMessage[]>([]);
/** 发送队列与草稿按会话保存：切走再切回时仍能看到发送中/失败的消息并重试 */
const outbox = reactive(new Map<string, Pending[]>());
const drafts = new Map<string, string>();
/**
 * 消息窗口版本：每次切换会话递增。异步请求发出时记下版本，返回时版本不同就丢弃，
 * 避免旧会话（或同一会话上一轮窗口）的响应写进当前面板。
 */
let windowVersion = 0;
const hasMore = ref(false);
const loading = ref(false);
const acting = ref(false);
const body = ref('');
const mode = ref<'note' | 'text'>('text');
const expanded = ref(new Set<string>());
const scroller = ref<HTMLElement>();

const conversation = computed(() => props.detail?.conversation ?? null);
const pending = computed(() => {
  const id = conversation.value?.id;
  return (id && outbox.get(id)) || [];
});
const isMine = computed(
  () =>
    conversation.value?.status === 'active' &&
    conversation.value.agentAdminId === userStore.userInfo?.userId,
);
const canText = computed(() => props.canReply && isMine.value);
const canNote = computed(
  () =>
    props.canReply &&
    conversation.value?.status !== 'closed' &&
    (isMine.value || props.supervise),
);
const canCompose = computed(() =>
  mode.value === 'text' ? canText.value : canNote.value,
);

watch(canText, (allowed) => {
  if (!allowed && canNote.value) mode.value = 'note';
  if (allowed) mode.value = 'text';
});

async function scrollToBottom() {
  await nextTick();
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight });
}

/** 只在页面可见时上报已读：后台标签页收到的消息不算读到，切回前台时再补报 */
async function reportRead() {
  if (document.visibilityState !== 'visible') return;
  const current = conversation.value;
  if (!current || !props.canReply || current.status !== 'active') return;
  if (!isMine.value && !props.supervise) return;
  const seq = readTarget(messages.value, current.agentReadSeq);
  if (seq !== null) await markReadApi(current.id, seq).catch(() => undefined);
}

function reportReadWhenVisible() {
  if (document.visibilityState === 'visible' && !loading.value)
    void reportRead();
}
onMounted(() =>
  document.addEventListener('visibilitychange', reportReadWhenVisible),
);
onBeforeUnmount(() =>
  document.removeEventListener('visibilitychange', reportReadWhenVisible),
);

watch(
  () => conversation.value?.id,
  async (id, previousId) => {
    const version = ++windowVersion;
    if (previousId) {
      if (body.value) drafts.set(previousId, body.value);
      else drafts.delete(previousId);
    }
    messages.value = [];
    hasMore.value = false;
    expanded.value = new Set();
    body.value = (id && drafts.get(id)) || '';
    if (!id) {
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const page = await listMessagesApi(id, { limit: 30 });
      if (version !== windowVersion) return;
      messages.value = page.items;
      hasMore.value = page.hasMore;
      await scrollToBottom();
      await reportRead();
    } finally {
      if (version === windowVersion) loading.value = false;
    }
  },
  { immediate: true },
);

/**
 * 增量拉取直到 hasMore=false。默认从已有最大 seq 之后拉；
 * 校准时从已加载窗口起点重拉，顺带更新断线期间完成的译文。
 */
async function fetchNewer(after = maxSeq(messages.value)) {
  const id = conversation.value?.id;
  if (!id) return;
  const version = windowVersion;
  const items = await fetchAllAfter(
    (cursor) => listMessagesApi(id, { after: cursor, limit: 100 }),
    after,
  );
  if (version !== windowVersion || items.length === 0) return;
  const atBottom =
    !scroller.value ||
    scroller.value.scrollHeight -
      scroller.value.scrollTop -
      scroller.value.clientHeight <
      80;
  messages.value = mergeMessages(messages.value, items);
  if (atBottom) await scrollToBottom();
  await reportRead();
}

// 收到事件后按 after 增量拉取；译文完成时只重取该条；ready 表示可能漏了事件，整窗校准
watch(
  () => props.event?.version,
  async () => {
    const id = conversation.value?.id;
    const event = props.event?.event;
    if (!id || !event) return;
    if (event.type === 'ready') {
      // 首屏仍在加载时拿到的就是最新数据，无需校准
      if (loading.value) return;
      const first = minSeq(messages.value);
      await fetchNewer(first === undefined ? 0 : first - 1);
      return;
    }
    if (event.type === 'message.translated' && event.seq) {
      const version = windowVersion;
      const page = await listMessagesApi(id, {
        after: event.seq - 1,
        limit: 1,
      });
      if (version !== windowVersion) return;
      messages.value = mergeMessages(messages.value, page.items);
      return;
    }
    await fetchNewer();
  },
);

async function loadOlder() {
  const id = conversation.value?.id;
  const before = minSeq(messages.value);
  if (!id || before === undefined) return;
  const previousHeight = scroller.value?.scrollHeight ?? 0;
  const version = windowVersion;
  const page = await listMessagesApi(id, { before, limit: 30 });
  // 切换过会话（包括切走再切回）时窗口已重建，旧游标拉到的历史会留下断层
  if (version !== windowVersion) return;
  messages.value = mergeMessages(messages.value, page.items);
  hasMore.value = page.hasMore;
  await nextTick();
  if (scroller.value)
    scroller.value.scrollTop += scroller.value.scrollHeight - previousHeight;
}

async function deliver(item: Pending) {
  const id = item.conversationId;
  item.status = 'sending';
  try {
    const { message } = await postMessageApi(id, {
      body: item.body,
      clientMessageId: item.clientMessageId,
      kind: item.kind,
    });
    const rest = (outbox.get(id) ?? []).filter((other) => other !== item);
    if (rest.length > 0) outbox.set(id, rest);
    else outbox.delete(id);
    // 发送期间已切到其他会话时只出队，消息由切回后的加载或事件拉取补上
    if (conversation.value?.id !== id) return;
    messages.value = mergeMessages(messages.value, [message]);
    await scrollToBottom();
  } catch {
    // 失败保留在列表中，重试时复用同一个 clientMessageId
    item.status = 'failed';
  }
}

async function send() {
  const id = conversation.value?.id;
  const text = body.value.trim();
  if (!id || !text || !canCompose.value) return;
  if (!outbox.has(id)) outbox.set(id, []);
  const queue = outbox.get(id);
  queue?.push({
    body: text,
    clientMessageId: crypto.randomUUID(),
    conversationId: id,
    kind: mode.value,
    status: 'sending',
  });
  // 取回响应式代理，后续状态变更才能触发渲染
  const item = queue?.at(-1);
  if (!item) return;
  body.value = '';
  await scrollToBottom();
  await deliver(item);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}

async function act(run: () => Promise<unknown>, success: string) {
  acting.value = true;
  try {
    await run();
    toast.success(success);
  } finally {
    acting.value = false;
    // 抢接冲突等失败也刷新列表，让坐席看到最新状态
    emit('changed');
  }
}

function claim() {
  const id = conversation.value?.id;
  if (!id) return;
  return act(() => claimConversationApi(id), '已接入');
}

function release() {
  const id = conversation.value?.id;
  if (!id) return;
  return act(() => releaseConversationApi(id), '已释放回队列');
}

function close() {
  const id = conversation.value?.id;
  if (!id) return;
  Modal.confirm({
    title: '结束本次会话？',
    content: '结束后客户再次发消息会开始新一轮会话。',
    okText: '结束会话',
    onOk: () => act(() => closeConversationApi(id), '会话已结束'),
  });
}

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col rounded-md border border-border bg-card"
  >
    <Empty
      v-if="!conversation"
      class="m-auto"
      description="从左侧选择一个会话"
    />
    <template v-else>
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2"
      >
        <div class="min-w-0">
          <div class="truncate font-medium">
            {{ customerLabel(conversation) }}
          </div>
          <div class="text-xs text-muted-foreground">
            {{ conversation.conversationNo }} ·
            {{ STATUS_LABELS[conversation.status] }} ·
            {{ CS_LOCALE_LABELS[conversation.customerLocale] }}
            <template v-if="conversation.agentName">
              · 坐席 {{ conversation.agentName }}
            </template>
          </div>
        </div>
        <Space>
          <Button
            v-if="canReply && conversation.status === 'queued'"
            :loading="acting"
            type="primary"
            @click="claim"
          >
            抢接
          </Button>
          <Button v-if="isMine" :loading="acting" @click="release">释放</Button>
          <Button
            v-if="supervise && conversation.status !== 'closed'"
            :disabled="acting"
            @click="emit('transfer')"
          >
            改派
          </Button>
          <Button
            v-if="
              canReply &&
              (isMine || (supervise && conversation.status !== 'closed'))
            "
            :loading="acting"
            danger
            @click="close"
          >
            结束
          </Button>
        </Space>
      </div>

      <div
        ref="scroller"
        class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
        :class="{ 'opacity-60': loading }"
      >
        <div v-if="hasMore" class="text-center">
          <Button size="small" type="link" @click="loadOlder">
            加载更早的消息
          </Button>
        </div>
        <template v-for="item in messages" :key="item.id">
          <div
            v-if="item.kind === 'event'"
            class="text-center text-xs text-muted-foreground"
          >
            {{ eventText(item) }} · {{ formatDateTime(item.createdAt) }}
          </div>
          <div
            v-else-if="item.kind === 'context' && item.context"
            class="mx-auto flex max-w-[90%] items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm"
          >
            <template v-if="item.context.kind === 'scheme'">
              <!-- 封面小图点击放大（换主题卡片为发送时选定的效果图）；方案下架或无图时退回图标 -->
              <Image
                v-if="!brokenCovers.has(schemeCardCoverUrl(item.context))"
                :src="schemeCardCoverUrl(item.context)"
                :alt="`${item.context.snapshot.schemeCode} ${item.context.snapshot.themeResultId ? 'AI 换主题效果图' : '效果图'}`"
                :width="80"
                :height="45"
                class="shrink-0 rounded-md border border-border object-cover"
                data-cs-scheme-cover
                @error="brokenCovers.add(schemeCardCoverUrl(item.context))"
              />
              <IconifyIcon
                v-else
                icon="lucide:box"
                class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="break-words text-xs text-muted-foreground">
                  方案 ·
                  <span class="font-mono">{{
                    item.context.snapshot.schemeCode
                  }}</span>
                  <template v-if="item.context.snapshot.themeResultId">
                    · <span data-cs-themed>AI 换主题效果</span>
                  </template>
                </p>
                <p
                  class="truncate font-medium"
                  :title="item.context.snapshot.name"
                >
                  {{ item.context.snapshot.name }}
                </p>
                <p class="text-xs text-muted-foreground">
                  <template
                    v-if="
                      item.context.snapshot.lengthMm &&
                      item.context.snapshot.widthMm
                    "
                  >
                    {{ item.context.snapshot.lengthMm / 1000 }} ×
                    {{ item.context.snapshot.widthMm / 1000 }} m
                  </template>
                  <template v-if="item.context.snapshot.openingCount">
                    · {{ item.context.snapshot.openingCount }} 面开口
                  </template>
                </p>
              </div>
            </template>
            <template v-else>
              <IconifyIcon
                icon="lucide:briefcase-business"
                class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="break-words text-xs text-muted-foreground">
                  项目 ·
                  <span class="font-mono">{{
                    item.context.snapshot.projectNo
                  }}</span>
                </p>
                <p
                  class="truncate font-medium"
                  :title="item.context.snapshot.exhibitionName"
                >
                  {{ item.context.snapshot.exhibitionName }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ item.context.snapshot.city }} ·
                  {{
                    projectStatusLabels[item.context.snapshot.status] ??
                    item.context.snapshot.status
                  }}
                </p>
              </div>
            </template>
          </div>
          <div
            v-else
            class="flex"
            :class="
              item.senderType === 'agent' ? 'justify-end' : 'justify-start'
            "
          >
            <div
              class="max-w-[75%] rounded-lg px-3 py-2"
              :class="
                item.kind === 'note'
                  ? 'border border-yellow-300 bg-yellow-50 text-yellow-900'
                  : item.senderType === 'agent'
                    ? 'bg-primary/10'
                    : 'bg-accent'
              "
            >
              <div class="mb-1 text-xs text-muted-foreground">
                <Tag v-if="item.kind === 'note'" class="m-0" color="gold">
                  内部备注
                </Tag>
                <Tag v-if="item.kind === 'offline'" class="m-0" color="purple">
                  留言
                </Tag>
                {{
                  item.senderName ??
                  (item.senderType === 'customer' ? '客户' : '客服')
                }}
                · {{ formatDateTime(item.createdAt) }}
              </div>
              <div class="whitespace-pre-wrap break-words">{{ item.body }}</div>
              <template v-if="translationOf(item)">
                <div
                  v-if="item.senderType === 'customer' || expanded.has(item.id)"
                  class="mt-1 whitespace-pre-wrap break-words border-t border-border pt-1 text-sm text-muted-foreground"
                >
                  {{
                    translationOf(item)!.body ??
                    translationHint(translationOf(item))
                  }}
                  <span
                    v-if="translationOf(item)!.status === 'failed'"
                    class="text-red-500"
                    >（翻译失败）</span>
                </div>
                <Button
                  v-if="item.senderType === 'agent'"
                  class="h-auto p-0 text-xs"
                  size="small"
                  type="link"
                  @click="toggle(item.id)"
                >
                  {{
                    expanded.has(item.id)
                      ? '收起译文'
                      : `查看${CS_LOCALE_LABELS[translationOf(item)!.locale]}译文`
                  }}
                </Button>
              </template>
            </div>
          </div>
        </template>
        <div
          v-for="item in pending"
          :key="item.clientMessageId"
          class="flex justify-end"
        >
          <div class="max-w-[75%] rounded-lg bg-primary/5 px-3 py-2 opacity-70">
            <div class="whitespace-pre-wrap break-words">{{ item.body }}</div>
            <div class="mt-1 text-xs">
              <span v-if="item.status === 'sending'">发送中…</span>
              <span v-else class="text-red-500">
                发送失败
                <Button
                  class="h-auto p-0 text-xs"
                  size="small"
                  type="link"
                  @click="deliver(item)"
                  >重试</Button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="canText || canNote"
        class="flex flex-col gap-2 border-t border-border px-4 py-2"
      >
        <Radio.Group
          v-model:value="mode"
          class="self-start"
          size="small"
          button-style="solid"
        >
          <Radio.Button :disabled="!canText" value="text">
            回复客户
          </Radio.Button>
          <Radio.Button :disabled="!canNote" value="note">
            内部备注
          </Radio.Button>
        </Radio.Group>
        <Input.TextArea
          v-model:value="body"
          :auto-size="{ minRows: 2, maxRows: 6 }"
          :maxlength="2000"
          :placeholder="
            mode === 'text'
              ? '输入回复，Enter 发送，Shift+Enter 换行；发送后自动翻译成客户语言'
              : '内部备注仅坐席可见'
          "
          show-count
          @keydown="onKeydown"
        />
        <div class="text-right">
          <Button
            :disabled="!body.trim() || !canCompose"
            type="primary"
            @click="send"
          >
            发送
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>
