<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  stages: { name: string; value: number }[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

// 框架只注册了柱状图，漏斗用横向柱状图表达，标签附带相对上一环节的转化率。
function render() {
  const stages = props.stages;
  renderEcharts({
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: 64,
      top: 8,
    },
    series: [
      {
        barMaxWidth: 28,
        data: stages.map((stage) => stage.value),
        itemStyle: { borderRadius: [0, 6, 6, 0], color: '#5ab1ef' },
        label: {
          formatter: ({ dataIndex, value }) => {
            const previous = stages[dataIndex - 1]?.value;
            if (!previous) return `${value}`;
            return `${value}（${Math.round((Number(value) / previous) * 100)}%）`;
          },
          position: 'right',
          show: true,
        },
        type: 'bar',
      },
    ],
    tooltip: { axisPointer: { type: 'shadow' }, trigger: 'axis' },
    xAxis: { minInterval: 1, show: false, type: 'value' },
    yAxis: {
      axisTick: { show: false },
      data: stages.map((stage) => stage.name),
      inverse: true,
      type: 'category',
    },
  });
}

onMounted(render);
watch(() => props.stages, render);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
