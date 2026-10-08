<script setup lang="ts">
import type { ConversationDetail } from '#/api/core/customer-service';

import { useRouter } from 'vue-router';

import { formatDateTime } from '@vben/utils';

import {
  Button,
  Descriptions,
  DescriptionsItem,
  Empty,
  Tag,
} from 'ant-design-vue';

import {
  CS_LOCALE_LABELS,
  customerLabel,
  STATUS_LABELS,
} from '#/api/core/customer-service';

defineProps<{ detail: ConversationDetail | null }>();
const emit = defineEmits<{ select: [id: string] }>();
const router = useRouter();

const sourceLabels = {
  manual_request: '人工需求',
  quote_request: '报价申请',
} as const;
const entryLabels = {
  floating: '悬浮按钮',
  my_project: '我的项目',
  quote_receipt: '受理回执',
  scheme_detail: '方案详情',
} as const;
</script>

<template>
  <div
    class="h-full min-h-0 space-y-3 overflow-y-auto rounded-md border border-border bg-card p-3"
  >
    <Empty v-if="!detail" class="mt-16" description="暂无上下文" />
    <template v-else>
      <section>
        <h3 class="mb-2 font-medium">客户信息</h3>
        <Descriptions :column="1" bordered size="small">
          <DescriptionsItem label="客户">
            {{ customerLabel(detail.conversation) }}
          </DescriptionsItem>
          <DescriptionsItem
            v-if="detail.conversation.customer.kind === 'user'"
            label="账号"
          >
            {{ detail.conversation.customer.username }}
          </DescriptionsItem>
          <DescriptionsItem label="邮箱">
            {{
              detail.conversation.contactEmail ??
              (detail.conversation.customer.kind === 'user'
                ? detail.conversation.customer.email
                : null) ??
              '—'
            }}
          </DescriptionsItem>
          <DescriptionsItem label="语言">
            {{ CS_LOCALE_LABELS[detail.conversation.customerLocale] }}
          </DescriptionsItem>
        </Descriptions>
      </section>

      <section>
        <h3 class="mb-2 font-medium">上下文</h3>
        <div
          v-if="detail.contexts.length === 0"
          class="text-xs text-muted-foreground"
        >
          客户未携带方案或项目
        </div>
        <div
          v-for="context in detail.contexts"
          :key="context.id"
          class="mb-2 rounded border border-border p-2 text-sm"
        >
          <div class="mb-1 flex items-center justify-between">
            <Tag :color="context.kind === 'scheme' ? 'blue' : 'green'">
              {{ context.kind === 'scheme' ? '方案' : '项目' }}
            </Tag>
            <span class="text-xs text-muted-foreground">{{
              entryLabels[context.entryPoint]
            }}</span>
          </div>
          <template v-if="context.kind === 'scheme'">
            <div>
              {{ context.snapshot.schemeCode }} · {{ context.snapshot.name }}
            </div>
            <div class="text-xs text-muted-foreground">
              <template
                v-if="context.snapshot.lengthMm && context.snapshot.widthMm"
              >
                {{ context.snapshot.lengthMm / 1000 }} ×
                {{ context.snapshot.widthMm / 1000 }} m
              </template>
              <template v-if="context.snapshot.openingCount">
                · {{ context.snapshot.openingCount }} 面开口
              </template>
            </div>
          </template>
          <template v-else>
            <div>
              {{ context.snapshot.projectNo }} ·
              {{ sourceLabels[context.snapshot.sourceType] }}
            </div>
            <div class="text-xs text-muted-foreground">
              {{ context.snapshot.exhibitionName }} ·
              {{ context.snapshot.countryCode }} {{ context.snapshot.city }}
              <template v-if="context.snapshot.schemeCode">
                · 方案 {{ context.snapshot.schemeCode }}
              </template>
            </div>
            <div class="text-xs text-muted-foreground">
              负责人：{{
                detail.projects.find(
                  (project) => project.projectId === context.projectId,
                )?.assigneeName ?? '—'
              }}
            </div>
            <Button
              v-access:code="['projects.read']"
              class="h-auto p-0"
              size="small"
              type="link"
              @click="router.push(`/projects/${context.projectId}`)"
            >
              查看项目
            </Button>
          </template>
        </div>
      </section>

      <section>
        <h3 class="mb-2 font-medium">历史会话</h3>
        <div
          v-if="detail.history.length === 0"
          class="text-xs text-muted-foreground"
        >
          无
        </div>
        <button
          v-for="item in detail.history"
          :key="item.id"
          type="button"
          class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
          @click="emit('select', item.id)"
        >
          {{ item.conversationNo }} · {{ STATUS_LABELS[item.status] }} ·
          {{ formatDateTime(item.createdAt) }}
        </button>
      </section>
    </template>
  </div>
</template>
