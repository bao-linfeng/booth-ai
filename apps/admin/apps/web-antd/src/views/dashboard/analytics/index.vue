<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';
import type { TabOption } from '@vben/types';

import type {
  AnalyticsFunnelKey,
  AnalyticsGenerationStatus,
  AnalyticsMetricKey,
  AnalyticsRangeDays,
  DashboardAnalytics,
} from '#/api/core/dashboard';

import { computed, onMounted, ref } from 'vue';

import {
  AnalysisChartCard,
  AnalysisChartsTabs,
  AnalysisOverview,
} from '@vben/common-ui';
import {
  SvgBellIcon,
  SvgCakeIcon,
  SvgCardIcon,
  SvgDownloadIcon,
} from '@vben/icons';
import { formatDateTime } from '@vben/utils';

import { Alert, Button, Empty, Segmented, Spin } from 'ant-design-vue';

import { getDashboardAnalyticsApi } from '#/api/core/dashboard';
import { statusLabels } from '#/api/core/projects';

import AnalyticsDistribution from './analytics-distribution.vue';
import AnalyticsFunnel from './analytics-funnel.vue';
import AnalyticsMonthlyProjects from './analytics-monthly-projects.vue';
import AnalyticsTrends from './analytics-trends.vue';

const metricMeta: Record<
  AnalyticsMetricKey,
  { icon: AnalysisOverviewItem['icon']; label: string; total: string }
> = {
  users: { icon: SvgCardIcon, label: '新增用户', total: '累计用户' },
  searches: { icon: SvgCakeIcon, label: '智选检索', total: '累计检索' },
  generations: {
    icon: SvgDownloadIcon,
    label: 'AI 生成任务',
    total: '累计生成任务',
  },
  projects: { icon: SvgBellIcon, label: '新增项目', total: '累计项目' },
};
const funnelLabels: Record<AnalyticsFunnelKey, string> = {
  visitors: '智选访客',
  matchedVisitors: '匹配到方案',
  generationUsers: '发起 AI 生成',
  inquiryCustomers: '提交询价',
  wonCustomers: '成交客户',
};
const generationStatusLabels: Record<AnalyticsGenerationStatus, string> = {
  succeeded: '成功',
  partially_succeeded: '部分成功',
  failed: '失败',
  processing: '进行中',
};
const rangeOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
];

const days = ref<AnalyticsRangeDays>(30);
const analytics = ref<DashboardAnalytics>();
const loading = ref(false);
const failed = ref(false);

const rangeLabel = computed(() => `近 ${days.value} 天`);
const overviewItems = computed<AnalysisOverviewItem[]>(() =>
  (analytics.value?.overview ?? []).map((item) => ({
    icon: metricMeta[item.key].icon,
    title: `${metricMeta[item.key].label}（${rangeLabel.value}）`,
    totalTitle: metricMeta[item.key].total,
    totalValue: item.total,
    value: item.value,
  })),
);
const trendSeries = computed(() =>
  (analytics.value?.trend ?? []).map((item) => ({
    data: item.data,
    name: metricMeta[item.key].label,
  })),
);
const chartTabs = computed<TabOption[]>(() => [
  ...(trendSeries.value.length > 0
    ? [{ label: '业务趋势', value: 'trends' }]
    : []),
  ...(analytics.value?.monthlyProjects
    ? [{ label: '月度项目', value: 'monthly' }]
    : []),
]);
const funnelStages = computed(() =>
  (analytics.value?.funnel ?? []).map((item) => ({
    name: funnelLabels[item.key],
    value: item.value,
  })),
);
const projectStatusData = computed(() =>
  analytics.value?.projectStatuses?.map((item) => ({
    name: statusLabels[item.key],
    value: item.value,
  })),
);
const generationStatusData = computed(() =>
  analytics.value?.generationStatuses?.map((item) => ({
    name: generationStatusLabels[item.key],
    value: item.value,
  })),
);
const hasAnyData = computed(
  () =>
    overviewItems.value.length > 0 ||
    funnelStages.value.length > 0 ||
    chartTabs.value.length > 0,
);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    analytics.value = await getDashboardAnalyticsApi(days.value);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-5">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Segmented
        v-model:value="days"
        :disabled="loading"
        :options="rangeOptions"
        @change="load"
      />
      <span v-if="analytics" class="text-muted-foreground text-sm">
        统计时间 {{ formatDateTime(analytics.generatedAt) }}（北京时间按自然日）
      </span>
    </div>

    <Alert
      v-if="failed"
      type="error"
      show-icon
      message="分析数据加载失败"
      class="mb-5"
    >
      <template #action>
        <Button size="small" @click="load">重试</Button>
      </template>
    </Alert>

    <Spin :spinning="loading">
      <Empty
        v-if="analytics && !hasAnyData"
        description="当前账号没有可查看的业务模块统计，请联系管理员分配用户、智选统计、生成任务或项目管理的查看权限。"
      />
      <template v-else-if="analytics">
        <AnalysisOverview
          v-if="overviewItems.length > 0"
          :items="overviewItems"
        />
        <AnalysisChartsTabs
          v-if="chartTabs.length > 0"
          :key="chartTabs.map((tab) => tab.value).join()"
          :tabs="chartTabs"
          class="mt-5"
        >
          <template #trends>
            <AnalyticsTrends :dates="analytics.dates" :series="trendSeries" />
          </template>
          <template #monthly>
            <AnalyticsMonthlyProjects
              v-if="analytics.monthlyProjects"
              :created="analytics.monthlyProjects.created"
              :months="analytics.months"
              :won="analytics.monthlyProjects.won"
            />
          </template>
        </AnalysisChartsTabs>

        <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <AnalysisChartCard
            v-if="funnelStages.length > 0"
            :title="`转化漏斗（${rangeLabel}）`"
          >
            <AnalyticsFunnel :stages="funnelStages" />
          </AnalysisChartCard>
          <AnalysisChartCard
            v-if="projectStatusData"
            :title="`项目状态（${rangeLabel}新增）`"
          >
            <AnalyticsDistribution :data="projectStatusData" name="项目状态" />
          </AnalysisChartCard>
          <AnalysisChartCard
            v-if="generationStatusData"
            :title="`AI 生成结果（${rangeLabel}）`"
          >
            <AnalyticsDistribution
              :data="generationStatusData"
              name="生成结果"
            />
          </AnalysisChartCard>
        </div>
      </template>
    </Spin>
  </div>
</template>
