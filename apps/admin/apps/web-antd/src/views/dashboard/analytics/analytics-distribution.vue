<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  data: { name: string; value: number }[];
  name: string;
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render() {
  renderEcharts({
    legend: { bottom: '2%', left: 'center' },
    series: [
      {
        avoidLabelOverlap: false,
        color: [
          '#5ab1ef',
          '#b6a2de',
          '#67e0e3',
          '#019680',
          '#ffb980',
          '#d87a80',
        ],
        data: props.data,
        emphasis: {
          label: { fontSize: '12', fontWeight: 'bold', show: true },
        },
        itemStyle: { borderRadius: 10, borderWidth: 2 },
        label: { position: 'center', show: false },
        labelLine: { show: false },
        name: props.name,
        radius: ['40%', '65%'],
        type: 'pie',
      },
    ],
    tooltip: { trigger: 'item' },
  });
}

onMounted(render);
watch(() => props.data, render);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
