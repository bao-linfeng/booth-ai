<script setup lang="ts">
import type {
  AdminMessage,
  ConversationDetail,
  WorkbenchEvent,
} from '#/api/core/customer-service';

import { computed, nextTick, ref, watch } from 'vue';

import { useUserStore } from '@vben/stores';
import { formatDateTime } from '@vben/utils';

import {
  Button,
  Empty,
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
  STATUS_LABELS,
} from '#/api/core/customer-service';

import {
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

interface Pending {
  body: string;
  clientMessageId: string;
  kind: 'note' | 'text';
  status: 'failed' | 'sending';
}

const userStore = useUserStore();
const messages = ref<AdminMessage[]>([]);
const pending = ref<Pending[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const acting = ref(false);
const body = ref('');
const mode = ref<'note' | 'text'>('text');
const expanded = ref(new Set<string>());
const scroller = ref<HTMLElement>();

const conversation = computed(() => props.detail?.conversation ?? null);
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

async function reportRead() {
  const current = conversation.value;
  if (!current || !props.canReply || current.status !== 'active') return;
  if (!isMine.value && !props.supervise) return;
  const seq = readTarget(messages.value, current.agentReadSeq);
  if (seq !== null) await markReadApi(current.id, seq).catch(() => undefined);
}

watch(
  () => conversation.value?.id,
  async (id) => {
    messages.value = [];
    pending.value = [];
    expanded.value = new Set();
    body.value = '';
    if (!id) return;
    loading.value = true;
    try {
      const page = await listMessagesApi(id, { limit: 30 });
      if (conversation.value?.id !== id) return;
      messages.value = page.items;
      hasMore.value = page.hasMore;
      await scrollToBottom();
      await reportRead();
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

async function fetchNewer() {
  const id = conversation.value?.id;
  if (!id) return;
  const page = await listMessagesApi(id, {
    after: maxSeq(messages.value),
    limit: 100,
  });
  if (conversation.value?.id !== id || page.items.length === 0) return;
  const atBottom =
    !scroller.value ||
    scroller.value.scrollHeight -
      scroller.value.scrollTop -
      scroller.value.clientHeight <
      80;
  messages.value = mergeMessages(messages.value, page.items);
  if (atBottom) await scrollToBottom();
  await reportRead();
}

// 收到事件后按 after 增量拉取；译文完成时只重取该条
watch(
  () => props.event?.version,
  async () => {
    const id = conversation.value?.id;
    const event = props.event?.event;
    if (!id || !event || event.type === 'ready') return;
    if (event.type === 'message.translated' && event.seq) {
      const page = await listMessagesApi(id, {
        after: event.seq - 1,
        limit: 1,
      });
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
  const page = await listMessagesApi(id, { before, limit: 30 });
  messages.value = mergeMessages(messages.value, page.items);
  hasMore.value = page.hasMore;
  await nextTick();
  if (scroller.value)
    scroller.value.scrollTop += scroller.value.scrollHeight - previousHeight;
}

async function deliver(item: Pending) {
  const id = conversation.value?.id;
  if (!id) return;
  item.status = 'sending';
  try {
    const { message } = await postMessageApi(id, {
      body: item.body,
      clientMessageId: item.clientMessageId,
      kind: item.kind,
    });
    pending.value = pending.value.filter((other) => other !== item);
    messages.value = mergeMessages(messages.value, [message]);
    await scrollToBottom();
  } catch {
    // 失败保留在列表中，重试时复用同一个 clientMessageId
    item.status = 'failed';
  }
}

async function send() {
  const text = body.value.trim();
  if (!text || !canCompose.value) return;
  pending.value.push({
    body: text,
    clientMessageId: crypto.randomUUID(),
    kind: mode.value,
    status: 'sending',
  });
  // 取回响应式代理，后续状态变更才能触发渲染
  const item = pending.value.at(-1);
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
            class="mx-auto max-w-md rounded border border-dashed border-border px-3 py-2 text-xs"
          >
            <template v-if="item.context.kind === 'scheme'">
              方案卡片：{{ item.context.snapshot.schemeCode }} ·
              {{ item.context.snapshot.name }}
            </template>
            <template v-else>
              项目卡片：{{ item.context.snapshot.projectNo }} ·
              {{ item.context.snapshot.exhibitionName }}
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

      <div v-if="canText || canNote" class="border-t border-border px-4 py-2">
        <Radio.Group
          v-model:value="mode"
          class="mb-2"
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
        <div class="mt-2 text-right">
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
