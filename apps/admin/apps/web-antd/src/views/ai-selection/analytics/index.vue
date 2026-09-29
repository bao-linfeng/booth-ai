<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { Page, VbenCountToAnimator } from '@vben/common-ui';
import { SvgBellIcon, SvgCakeIcon, SvgCardIcon, SvgDownloadIcon } from '@vben/icons';
import type { EchartsUIType } from '@vben/plugins/echarts';
import { EchartsUI, useEcharts } from '@vben/plugins/echarts';
import { Card, DatePicker, Segmented } from 'ant-design-vue';

import { getSchemeSearchStatisticsApi, type SchemeSearchStatistics } from '#/api/core/scheme-searches';

type Granularity = 'date' | 'hour';

const statistics = ref<SchemeSearchStatistics>();
const range = ref<[string, string] | undefined>();
const granularity = ref<Granularity>('date');
const trendRef = ref<EchartsUIType>();
const termRef = ref<EchartsUIType>();
const { renderEcharts: renderTrend } = useEcharts(trendRef);
const { renderEcharts: renderTerms } = useEcharts(termRef);

const overviewItems = computed(() => {
  const overview = statistics.value?.overview;
  const searches = overview?.searches ?? 0;
  return [
    { title: '方案数', value: overview?.schemeCount ?? 0, icon: SvgCardIcon, tone: 'amber' },
    { title: '检索数', value: searches, icon: SvgCakeIcon, tone: 'blue' },
    { title: '用户检索数', value: overview?.loggedInSearches ?? 0, icon: SvgDownloadIcon, tone: 'green' },
    { title: '命中率', value: searches ? (overview?.matchedSearches ?? 0) / searches * 100 : 0, icon: SvgBellIcon, tone: 'rose', suffix: '%' },
  ];
});

async function load() {
  const dates = range.value;
  statistics.value = await getSchemeSearchStatisticsApi({ from: dates?.[0], to: dates?.[1], granularity: granularity.value });
  const data = statistics.value;

  renderTrend({
    color: ['#2563eb', '#16a34a', '#f97316'],
    grid: { left: 12, right: 16, top: 28, bottom: 12, containLabel: true },
    legend: { data: ['检索数', '命中数', '用户检索数'], top: 0 },
    tooltip: { trigger: 'axis' },
    xAxis: { boundaryGap: false, data: data.trend.map(item => item.date), type: 'category' },
    yAxis: { type: 'value' },
    series: [
      { name: '检索数', type: 'line', smooth: true, symbol: 'none', data: data.trend.map(item => item.searches) },
      { name: '命中数', type: 'line', smooth: true, symbol: 'none', data: data.trend.map(item => item.matched) },
      { name: '用户检索数', type: 'line', smooth: true, symbol: 'none', data: data.trend.map(item => item.loggedIn) },
    ],
  });

  const datesInTerms = [...new Set(data.popularTerms.map(item => item.date))];
  const terms = [...new Set(data.popularTerms.map(item => item.term))];
  const termCount = new Map(data.popularTerms.map(item => [`${item.date}:${item.term}`, item.count]));
  renderTerms({
    color: ['#0f766e', '#0891b2', '#7c3aed', '#db2777', '#ea580c'],
    grid: { left: 12, right: 16, top: 28, bottom: 12, containLabel: true },
    legend: { data: terms, top: 0, type: 'scroll' },
    tooltip: { trigger: 'axis' },
    xAxis: { boundaryGap: false, data: datesInTerms, type: 'category' },
    yAxis: { type: 'value' },
    series: terms.map(term => ({
      name: term,
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: datesInTerms.map(date => termCount.get(`${date}:${term}`) ?? 0),
    })),
  });
}

function updateGranularity(value: string | number) {
  if (value !== 'date' && value !== 'hour') return;
  granularity.value = value;
  load();
}

onMounted(load);
</script>

<template>
  <Page auto-content-height>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">趋势与统计</h1>
        <p class="text-muted-foreground text-sm">追踪 AI 智选的检索活跃度与需求偏好</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <Segmented :value="granularity" :options="[{ label: '按日期', value: 'date' }, { label: '按小时', value: 'hour' }]" @change="updateGranularity" />
        <DatePicker.RangePicker v-model:value="range" value-format="YYYY-MM-DD" @change="load" />
      </div>
    </div>

    <div v-if="statistics" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card v-for="item in overviewItems" :key="item.title" class="analytics-overview-card">
        <div class="flex items-start justify-between">
          <div>
            <div class="text-muted-foreground text-sm">{{ item.title }}</div>
            <div class="mt-3 flex items-baseline gap-1 text-3xl font-semibold tracking-tight">
              <VbenCountToAnimator :end-val="item.value" :decimals="item.suffix ? 2 : 0" :suffix="item.suffix" />
            </div>
          </div>
          <div class="analytics-overview-icon" :class="`is-${item.tone}`">
            <component :is="item.icon" class="size-5" />
          </div>
        </div>
      </Card>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
      <div>
        <Card title="检索趋势">
          <EchartsUI ref="trendRef" height="340px" />
        </Card>
      </div>
      <div>
        <Card title="热门需求词" extra="AI 筛选 · 按日期">
          <EchartsUI ref="termRef" height="340px" />
        </Card>
      </div>
    </div>
  </Page>
</template>

<style scoped>
.analytics-overview-card {
  border: 1px solid hsl(var(--border));
  box-shadow: 0 12px 28px rgb(15 23 42 / 5%);
}

.analytics-overview-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

.is-amber {
  color: #b45309;
  background: #fef3c7;
}

.is-blue {
  color: #1d4ed8;
  background: #dbeafe;
}

.is-green {
  color: #15803d;
  background: #dcfce7;
}

.is-rose {
  color: #be123c;
  background: #ffe4e6;
}
</style>
