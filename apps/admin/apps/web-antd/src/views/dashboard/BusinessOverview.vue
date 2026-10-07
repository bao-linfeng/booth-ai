<script setup lang="ts">
import type { DashboardSummary } from '#/api/core/dashboard';

import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import {
  Alert,
  Button,
  Card,
  Empty,
  Skeleton,
  Table,
  Tag,
} from 'ant-design-vue';

import { getDashboardSummaryApi } from '#/api/core/dashboard';
import { statusLabels } from '#/api/core/projects';

import SelectionOverview from './SelectionOverview.vue';

defineProps<{ title: string }>();

const router = useRouter();
const { hasAccessByCodes } = useAccess();
const summary = ref<DashboardSummary>();
const loading = ref(false);
const failed = ref(false);
const quickLinks = computed(() =>
  [
    { name: 'ProjectList', label: '项目承接', permission: 'projects.read' },
    { name: 'SchemeList', label: '方案列表', permission: 'schemes.read' },
    {
      name: 'GenerationJobs',
      label: '生成任务',
      permission: 'generation.read',
    },
    {
      name: 'ProjectNotifications',
      label: '消息通知',
      permission: 'notifications.read',
    },
    {
      name: 'AiSelectionAnalytics',
      label: '智选统计',
      permission: 'search-analytics.read',
    },
  ].filter(
    (item) => hasAccessByCodes([item.permission]) && router.hasRoute(item.name),
  ),
);
const metrics = computed(() => {
  const data = summary.value;
  if (!data) return [];
  return [
    ...(data.projects
      ? [
          {
            title: '待跟进项目',
            value: data.projects.pending,
            description: '当前状态为待跟进的项目',
          },
          {
            title: '今日计划跟进',
            value: data.projects.todayFollowUps,
            description: '最新跟进记录约定在今天联系',
          },
          {
            title: '逾期跟进项目',
            value: data.projects.overdueFollowUps,
            description: '最新计划跟进时间已过，项目未结束',
          },
        ]
      : []),
    ...(data.schemes
      ? [
          {
            title: '未核验方案',
            value: data.schemes.unverified,
            description: '核验状态为未核验，不代表待审核队列',
          },
        ]
      : []),
    ...(data.generation
      ? [
          {
            title: '失败生成任务',
            value: data.generation.failed,
            description: '主题与画稿任务中，状态为失败的总数',
          },
        ]
      : []),
    ...(data.notifications
      ? [
          {
            title: '通知投递失败',
            value: data.notifications.failed,
            description: '投递失败且尚未成功送达的通知',
          },
        ]
      : []),
  ];
});
const inquiryColumns = [
  { title: '询价项目', key: 'projectNo' },
  { title: '客户', key: 'customer' },
  { title: '成交状态', key: 'status' },
  { title: '受理时间', key: 'createdAt' },
];

async function load() {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  summary.value = undefined;
  try {
    summary.value = await getDashboardSummaryApi();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Page>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">{{ title }}</h1>
        <p class="text-muted-foreground mt-1 text-sm">
          查看待处理事项与最近询价，仅展示当前账号有权访问的数据。
        </p>
      </div>
      <Button :loading="loading" @click="load">刷新业务数据</Button>
    </div>

    <Card title="业务入口" class="mb-4">
      <nav
        v-if="quickLinks.length"
        aria-label="业务快捷入口"
        class="flex flex-wrap gap-x-6 gap-y-3"
      >
        <RouterLink
          v-for="item in quickLinks"
          :key="item.name"
          :to="{ name: item.name }"
          class="text-primary underline underline-offset-4"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
      <p v-else class="text-muted-foreground mb-0">
        当前账号暂无业务页面权限，请联系管理员配置。
      </p>
    </Card>

    <Alert
      v-if="failed"
      type="error"
      show-icon
      message="业务数据加载失败"
      class="mb-4"
      description="未能取得最新业务数据，请点击“刷新业务数据”重试。"
    />
    <Card v-else-if="loading" class="mb-4"><Skeleton active /></Card>
    <template v-else-if="summary">
      <Card title="待处理与异常" class="mb-4">
        <dl
          v-if="metrics.length"
          class="mb-0 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
        >
          <div v-for="item in metrics" :key="item.title">
            <dt class="text-muted-foreground text-sm">{{ item.title }}</dt>
            <dd class="mb-1 mt-2 text-2xl font-semibold tabular-nums">
              {{ item.value.toLocaleString() }}
            </dd>
            <dd class="text-muted-foreground mb-0 text-sm">
              {{ item.description }}
            </dd>
          </div>
        </dl>
        <Empty v-else description="当前账号暂无业务数据权限" />
        <p class="text-muted-foreground mb-0 mt-5 text-sm">
          数据更新于
          {{
            formatDateTime(summary.generatedAt)
          }}；今日按上海时区统计，今日计划与逾期可能重叠。
        </p>
      </Card>

      <Card v-if="summary.projects" title="最近询价及成交状态" class="mb-4">
        <Table
          :columns="inquiryColumns"
          :data-source="summary.projects.recentInquiries"
          :pagination="false"
          :scroll="{ x: 640 }"
          row-key="projectId"
        >
          <template #emptyText>暂无询价项目</template>
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'projectNo'">
              <RouterLink
                v-if="router.hasRoute('ProjectDetail')"
                :to="{
                  name: 'ProjectDetail',
                  params: { projectId: record.projectId },
                }"
                class="text-primary underline underline-offset-4"
              >
                {{ record.projectNo }}
              </RouterLink>
              <span v-else>{{ record.projectNo }}</span>
            </template>
            <template v-else-if="column.key === 'customer'">
              {{ record.company || record.contactName || '未填写' }}
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag>
                {{ statusLabels[record.status as keyof typeof statusLabels] }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'createdAt'">
              {{ formatDateTime(record.createdAt) }}
            </template>
          </template>
        </Table>
        <p class="text-muted-foreground mb-0 mt-3 text-sm">
          按受理时间显示最近 5 条报价申请；成交状态取自项目跟进记录。
        </p>
      </Card>
    </template>

    <SelectionOverview v-if="hasAccessByCodes(['search-analytics.read'])" />
  </Page>
</template>
