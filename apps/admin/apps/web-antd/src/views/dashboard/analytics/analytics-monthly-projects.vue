<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  created: number[];
  months: string[];
  won: number[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render() {
  renderEcharts({
    color: ['#5ab1ef', '#019680'],
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: 36,
    },
    legend: { top: 0 },
    series: [
      { barMaxWidth: 40, data: props.created, name: '新增项目', type: 'bar' },
      {
        barMaxWidth: 40,
        data: props.won,
        name: '其中已成交',
        type: 'bar',
      },
    ],
    tooltip: { axisPointer: { type: 'shadow' }, trigger: 'axis' },
    xAxis: { data: props.months, type: 'category' },
    yAxis: { minInterval: 1, splitNumber: 4, type: 'value' },
  });
}

onMounted(render);
watch(() => [props.months, props.created, props.won], render);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
