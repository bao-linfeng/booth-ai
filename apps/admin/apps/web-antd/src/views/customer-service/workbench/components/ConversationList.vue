<script setup lang="ts">
import type {
  AdminConversation,
  ConversationCounts,
  ConversationTab,
} from '#/api/core/customer-service';

import { computed, onBeforeUnmount, ref } from 'vue';

import { Badge, Empty, Pagination, Tag } from 'ant-design-vue';

import {
  CS_LOCALE_LABELS,
  customerLabel,
  STATUS_LABELS,
  TAB_LABELS,
} from '#/api/core/customer-service';

import { waitingText } from '../timeline';

const props = defineProps<{
  counts: ConversationCounts;
  items: AdminConversation[];
  loading: boolean;
  page: number;
  pageSize: number;
  selectedId: null | string;
  supervise: boolean;
  tab: ConversationTab;
  total: number;
}>();
const emit = defineEmits<{
  'update:page': [page: number];
  'update:tab': [tab: ConversationTab];
  select: [id: string];
}>();

// 等待时长每秒刷新
const now = ref(Date.now());
const timer = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(timer));

const tabs = computed(() =>
  (['queue', 'mine', 'offline', 'all', 'closed'] as ConversationTab[])
    .filter((tab) => tab !== 'all' || props.supervise)
    .map((tab) => ({
      key: tab,
      label: TAB_LABELS[tab],
      count:
        tab === 'queue' || tab === 'mine' || tab === 'offline'
          ? props.counts[tab]
          : null,
    })),
);

// 标签上的计数做成右上角的小角标
const badgeStyle = {
  fontSize: '10px',
  height: '14px',
  lineHeight: '14px',
  minWidth: '14px',
  padding: '0 4px',
};

const statusColors = {
  active: 'green',
  closed: 'default',
  queued: 'orange',
} as const;
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col rounded-md border border-border bg-card"
  >
    <!-- 不用 antd Tabs：栏宽放不下全部标签时它会折叠并滚走当前项，这里平铺并均分留白 -->
    <div class="flex border-b border-border px-2" role="tablist">
      <button
        v-for="item in tabs"
        :key="item.key"
        type="button"
        role="tab"
        :aria-selected="item.key === tab"
        class="group relative flex-auto whitespace-nowrap pb-2.5 pt-3 text-center text-sm"
        @click="emit('update:tab', item.key)"
      >
        <Badge
          :count="item.count ?? 0"
          :number-style="badgeStyle"
          :offset="[4, 0]"
          size="small"
        >
          <!-- Badge 会重置文字颜色，颜色需写在内层 -->
          <span
            class="transition-colors group-hover:text-primary"
            :class="
              item.key === tab ? 'font-medium text-primary' : 'text-foreground'
            "
          >
            {{ item.label }}
          </span>
        </Badge>
        <span
          v-if="item.key === tab"
          class="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
        ></span>
      </button>
    </div>
    <div
      class="min-h-0 flex-1 overflow-y-auto"
      :class="{ 'opacity-60': loading }"
    >
      <Empty v-if="items.length === 0" class="mt-16" description="暂无会话" />
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="block w-full border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent"
        :class="{ 'bg-accent': item.id === selectedId }"
        @click="emit('select', item.id)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-medium">{{ customerLabel(item) }}</span>
          <Badge
            v-if="item.unreadCount"
            :count="item.unreadCount"
            size="small"
          />
        </div>
        <div class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{{ item.conversationNo }}</span>
          <Tag class="m-0" :color="statusColors[item.status]">
            {{ STATUS_LABELS[item.status] }}
          </Tag>
          <span>{{ CS_LOCALE_LABELS[item.customerLocale] }}</span>
          <Tag v-if="item.hasOfflineMessage" class="m-0" color="purple">
            留言
          </Tag>
        </div>
        <div
          v-if="item.contextSummary.length"
          class="mt-1 truncate text-xs text-muted-foreground"
        >
          {{ item.contextSummary.join('、') }}
        </div>
        <div class="mt-1 flex items-center justify-between gap-2 text-xs">
          <span class="truncate">{{
            item.lastMessagePreview ?? '（暂无消息）'
          }}</span>
          <span
            v-if="item.status === 'queued' && item.awaitingSince"
            class="shrink-0 text-orange-500"
          >
            等待 {{ waitingText(item.awaitingSince, now) }}
          </span>
        </div>
      </button>
    </div>
    <Pagination
      v-if="total > pageSize"
      class="border-t border-border px-3 py-2 text-center"
      :current="page"
      :page-size="pageSize"
      :total="total"
      simple
      size="small"
      @change="(value) => emit('update:page', value)"
    />
  </div>
</template>
