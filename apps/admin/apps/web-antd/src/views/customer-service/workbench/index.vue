<script setup lang="ts">
import type {
  AdminConversation,
  ConversationDetail,
  ConversationTab,
  WorkbenchEvent,
} from '#/api/core/customer-service';

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { debounce } from '@vben/utils';

import { Badge, Switch, Tooltip } from 'ant-design-vue';

import {
  getConversationApi,
  listConversationsApi,
} from '#/api/core/customer-service';
import { useCustomerServiceStore } from '#/store';

import ContextPanel from './components/ContextPanel.vue';
import ConversationList from './components/ConversationList.vue';
import ConversationPanel from './components/ConversationPanel.vue';
import TransferModal from './components/TransferModal.vue';

const PAGE_SIZE = 20;
const route = useRoute();
const router = useRouter();
const store = useCustomerServiceStore();
const { hasAccessByCodes } = useAccess();
const canReply = hasAccessByCodes(['customer-service.reply']);
const supervise = hasAccessByCodes(['customer-service.supervise']);

// 恢复上次停留的标签；“全部”仅主管可见
const tab = ref<ConversationTab>(
  store.workbenchTab === 'all' && !supervise ? 'queue' : store.workbenchTab,
);
const page = ref(1);
const items = ref<AdminConversation[]>([]);
const total = ref(0);
const listLoading = ref(false);
const selectedId = ref<null | string>(
  typeof route.query.conversationId === 'string'
    ? route.query.conversationId
    : null,
);
const detail = ref<ConversationDetail | null>(null);
const panelEvent = ref<null | { event: WorkbenchEvent; version: number }>(null);
const transferRef = ref<InstanceType<typeof TransferModal>>();
let eventVersion = 0;
/** 列表请求版本：只采用最后一次请求的响应，快速切换页签或翻页时旧响应不会覆盖新页面 */
let listVersion = 0;

async function loadList() {
  const version = ++listVersion;
  listLoading.value = true;
  try {
    const result = await listConversationsApi({
      page: page.value,
      pageSize: PAGE_SIZE,
      tab: tab.value,
    });
    if (version !== listVersion) return;
    items.value = result.items;
    total.value = result.total;
    store.counts = result.counts;
  } finally {
    if (version === listVersion) listLoading.value = false;
  }
}

async function loadDetail() {
  const id = selectedId.value;
  if (!id) {
    detail.value = null;
    return;
  }
  try {
    const result = await getConversationApi(id);
    if (selectedId.value === id) detail.value = result;
  } catch {
    // 会话已不可见（例如被改派给他人）时清空面板
    if (selectedId.value === id) {
      detail.value = null;
      selectedId.value = null;
    }
  }
}

function refreshAll() {
  void loadList();
  void loadDetail();
}

const refreshList = debounce(loadList, 300);
const refreshDetail = debounce(loadDetail, 300);

function select(id: string) {
  selectedId.value = id;
  store.requestNotificationPermission();
}

watch(selectedId, (id) => {
  void router.replace({
    query: { ...route.query, conversationId: id ?? undefined },
  });
  void loadDetail();
});
watch(tab, (value) => {
  store.workbenchTab = value;
  page.value = 1;
  void loadList();
});
watch(page, () => void loadList());

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  refreshAll();
  // 事件只含 ID：列表防抖重拉；当前会话的事件交给对话面板增量拉取。
  // ready 只在重连或降级轮询时转发，表示可能漏了事件：列表、详情、消息全部校准
  unsubscribe = store.subscribe((event) => {
    refreshList();
    if (event.type === 'ready') {
      refreshDetail();
      panelEvent.value = { event, version: ++eventVersion };
      return;
    }
    if (event.conversationId === selectedId.value) {
      panelEvent.value = { event, version: ++eventVersion };
      if (
        event.type !== 'message.created' &&
        event.type !== 'message.translated'
      )
        refreshDetail();
    }
  });
});
onBeforeUnmount(() => unsubscribe?.());

function openTransfer() {
  const conversation = detail.value?.conversation;
  if (conversation)
    transferRef.value?.open(conversation.id, conversation.agentAdminId);
}

async function togglePresence(online: boolean) {
  await store.setPresence(online ? 'online' : 'away');
}
</script>

<template>
  <Page
    auto-content-height
    content-class="flex flex-col gap-3"
    @click.capture="store.requestNotificationPermission()"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge :status="store.connected ? 'success' : 'warning'" />
        {{ store.connected ? '实时连接正常' : '实时连接中断，正在重连' }}
      </div>
      <Tooltip
        v-if="canReply"
        title="离开时不计入在线坐席，客户端会进入留言模式"
      >
        <span class="flex items-center gap-2 text-sm">
          在线状态
          <Switch
            :checked="store.presence === 'online'"
            checked-children="在线"
            un-checked-children="离开"
            @change="(checked) => togglePresence(Boolean(checked))"
          />
        </span>
      </Tooltip>
    </div>
    <div class="flex min-h-0 flex-1 gap-3">
      <ConversationList
        v-model:page="page"
        v-model:tab="tab"
        class="w-[22rem] shrink-0"
        :counts="store.counts"
        :items="items"
        :loading="listLoading"
        :page-size="PAGE_SIZE"
        :selected-id="selectedId"
        :supervise="supervise"
        :total="total"
        @select="select"
      />
      <ConversationPanel
        class="min-w-0 flex-1"
        :can-reply="canReply"
        :detail="detail"
        :event="panelEvent"
        :supervise="supervise"
        @changed="refreshAll"
        @transfer="openTransfer"
      />
      <ContextPanel class="w-80 shrink-0" :detail="detail" @select="select" />
    </div>
    <TransferModal ref="transferRef" @done="refreshAll" />
  </Page>
</template>
