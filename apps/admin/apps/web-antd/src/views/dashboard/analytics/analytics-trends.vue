<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  dates: string[];
  series: { data: number[]; name: string }[];
}>();

const colors = ['#5ab1ef', '#019680', '#b6a2de', '#ffb980'];
const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render() {
  renderEcharts({
    color: colors,
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: 36,
    },
    legend: { top: 0 },
    series: props.series.map((item) => ({
      areaStyle: { opacity: 0.15 },
      data: item.data,
      name: item.name,
      smooth: true,
      type: 'line',
    })),
    tooltip: { trigger: 'axis' },
    xAxis: {
      axisTick: { show: false },
      boundaryGap: false,
      // 只显示月-日，年份在悬浮提示中不重要
      data: props.dates.map((date) => date.slice(5)),
      splitLine: { lineStyle: { type: 'solid', width: 1 }, show: true },
      type: 'category',
    },
    yAxis: {
      axisTick: { show: false },
      minInterval: 1,
      splitArea: { show: true },
      splitNumber: 4,
      type: 'value',
    },
  });
}

onMounted(render);
watch(() => [props.dates, props.series], render);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
