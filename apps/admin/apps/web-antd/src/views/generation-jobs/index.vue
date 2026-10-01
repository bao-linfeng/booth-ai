<script setup lang="ts">
import type {
  GenerationJob,
  GenerationJobDetail,
  GenerationJobStatus,
  JobType,
} from '#/api/core/generation-jobs';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Image,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  getGenerationJobApi,
  listGenerationJobsApi,
} from '#/api/core/generation-jobs';

const statusLabels: Record<GenerationJobStatus, string> = {
  pending: '排队中',
  queued: '已入队',
  running: '执行中',
  settling: '结算中',
  succeeded: '成功',
  partially_succeeded: '部分成功',
  failed: '失败',
};

const statusColors: Record<GenerationJobStatus, string> = {
  pending: 'default',
  queued: 'blue',
  running: 'processing',
  settling: 'orange',
  succeeded: 'success',
  partially_succeeded: 'gold',
  failed: 'error',
};

const statuses = Object.entries(statusLabels).map(([value, label]) => ({
  value,
  label,
}));

const jobTypes = [
  { label: '主题生成', value: 'theme' },
  { label: '平面素材', value: 'artwork' },
];

function formatDuration(ms: null | number | undefined) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const [Grid] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: { options: statuses, allowClear: true },
      },
      {
        component: 'Select',
        fieldName: 'jobType',
        label: '任务类型',
        componentProps: { options: jobTypes, allowClear: true },
      },
      {
        component: 'Input',
        fieldName: 'schemeCode',
        label: '方案编号',
        componentProps: { allowClear: true, placeholder: '方案编号' },
      },
      {
        component: 'DatePicker',
        fieldName: 'from',
        label: '开始日期',
        componentProps: { valueFormat: 'YYYY-MM-DD' },
      },
      {
        component: 'DatePicker',
        fieldName: 'to',
        label: '结束日期',
        componentProps: { valueFormat: 'YYYY-MM-DD' },
      },
    ],
  },
  gridOptions: {
    height: 'auto',
    showOverflow: 'tooltip',
    toolbarConfig: { refresh: true },
    columns: [
      { field: 'id', title: '任务ID', minWidth: 200, slots: { default: 'id' } },
      {
        field: 'jobType',
        title: '类型',
        minWidth: 100,
        slots: { default: 'jobType' },
      },
      { field: 'schemeCode', title: '方案编号', minWidth: 120 },
      {
        field: 'status',
        title: '状态',
        minWidth: 100,
        slots: { default: 'status' },
      },
      {
        field: 'counts',
        title: '请求/成功',
        minWidth: 100,
        slots: { default: 'counts' },
      },
      {
        field: 'durationMs',
        title: '耗时',
        minWidth: 90,
        slots: { default: 'duration' },
      },
      {
        field: 'totalCreditsConsumed',
        title: '消耗积分',
        minWidth: 100,
        slots: { default: 'credits' },
      },
      {
        field: 'createdAt',
        title: '创建时间',
        minWidth: 160,
        slots: { default: 'createdAt' },
      },
      {
        field: 'action',
        title: '操作',
        width: 80,
        fixed: 'right',
        slots: { default: 'action' },
      },
    ],
    pagerConfig: { enabled: true, pageSize: 20 },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: {
            status?: GenerationJobStatus;
            jobType?: JobType;
            schemeCode?: string;
            from?: string;
            to?: string;
          } = {},
        ) => {
          const result = await listGenerationJobsApi({
            page: page.currentPage,
            pageSize: page.pageSize,
            ...(formValues.status ? { status: formValues.status } : {}),
            ...(formValues.jobType ? { jobType: formValues.jobType } : {}),
            ...(formValues.schemeCode?.trim()
              ? { schemeCode: formValues.schemeCode.trim() }
              : {}),
            ...(formValues.from ? { from: formValues.from } : {}),
            ...(formValues.to ? { to: formValues.to } : {}),
          });
          return { items: result.data, total: result.total };
        },
      },
    },
  },
});

const detailOpen = ref(false);
const detail = ref<GenerationJobDetail>();
const detailLoading = ref(false);

async function openDetail(id: string) {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = undefined;
  try {
    detail.value = await getGenerationJobApi(id);
  } finally {
    detailLoading.value = false;
  }
}
</script>

<template>
  <Page auto-content-height title="生成任务">
    <Grid>
      <template #id="{ row }">
        <Tooltip :title="(row as GenerationJob).id">
          {{ (row as GenerationJob).id.substring(0, 8) }}
        </Tooltip>
      </template>
      <template #jobType="{ row }">
        {{
          (row as GenerationJob).jobType === 'theme' ? '主题生成' : '平面素材'
        }}
      </template>
      <template #status="{ row }">
        <Tag :color="statusColors[(row as GenerationJob).status]">
          {{ statusLabels[(row as GenerationJob).status] }}
        </Tag>
      </template>
      <template #counts="{ row }">
        {{ (row as GenerationJob).requestedCount }}/{{
          (row as GenerationJob).usableCount
        }}
      </template>
      <template #duration="{ row }">
        {{ formatDuration((row as GenerationJob).durationMs) }}
      </template>
      <template #credits="{ row }">
        {{ (row as GenerationJob).totalCreditsConsumed ?? '—' }}
      </template>
      <template #createdAt="{ row }">
        {{ formatDateTime((row as GenerationJob).createdAt) }}
      </template>
      <template #action="{ row }">
        <Button
          type="link"
          size="small"
          @click="openDetail((row as GenerationJob).id)"
        >
          查看
        </Button>
      </template>
    </Grid>

    <Drawer
      v-model:open="detailOpen"
      title="生成任务详情"
      :width="720"
      :destroy-on-close="true"
    >
      <div v-if="detailLoading" class="py-12 text-center text-gray-400">
        加载中...
      </div>
      <div v-else-if="detail">
        <Alert
          v-if="
            detail.usableCount < detail.requestedCount &&
            !['pending', 'queued', 'running', 'settling'].includes(
              detail.status,
            )
          "
          type="warning"
          message="部分或全部生成失败，实际成功数量低于请求数量"
          show-icon
          class="mb-4"
        />

        <Descriptions bordered :column="2" size="small">
          <DescriptionsItem label="任务ID" :span="2">
            {{ detail.id }}
          </DescriptionsItem>
          <DescriptionsItem label="类型">
            {{ detail.jobType === 'theme' ? '主题生成' : '平面素材' }}
          </DescriptionsItem>
          <DescriptionsItem label="状态">
            <Tag :color="statusColors[detail.status]">
              {{ statusLabels[detail.status] }}
            </Tag>
            <span v-if="detail.phase" class="text-xs text-gray-500 ml-1">/ {{ detail.phase }}</span>
          </DescriptionsItem>

          <DescriptionsItem label="方案编号">
            {{ detail.schemeCode || '—' }}
          </DescriptionsItem>
          <DescriptionsItem label="用户名">
            {{ detail.username ?? detail.userId }}
          </DescriptionsItem>

          <DescriptionsItem label="行业">
            {{ detail.industryLabel ?? '—' }}
          </DescriptionsItem>
          <DescriptionsItem label="风格">
            {{ detail.styleLabel ?? '—' }}
          </DescriptionsItem>

          <DescriptionsItem label="请求数量">
            {{ detail.requestedCount }}
          </DescriptionsItem>
          <DescriptionsItem label="成功数量">
            {{ detail.usableCount }}
          </DescriptionsItem>

          <DescriptionsItem label="积分单价">
            {{ detail.unitCredits ?? '—' }}
          </DescriptionsItem>
          <DescriptionsItem label="消耗积分">
            {{ detail.totalCreditsConsumed ?? '—' }}
          </DescriptionsItem>

          <DescriptionsItem label="耗时">
            {{ formatDuration(detail.durationMs) }}
          </DescriptionsItem>
          <DescriptionsItem label="缓存模式">
            {{ detail.cacheMode === 'reuse' ? '复用' : '强刷' }}
          </DescriptionsItem>

          <DescriptionsItem label="品牌色">
            {{
              detail.input.brandColors && detail.input.brandColors.length > 0
                ? detail.input.brandColors.join('、')
                : '—'
            }}
          </DescriptionsItem>
          <DescriptionsItem label="品牌关键词">
            {{ detail.input.brandKeywords || '—' }}
          </DescriptionsItem>

          <DescriptionsItem label="创建时间">
            {{ formatDateTime(detail.createdAt) }}
          </DescriptionsItem>
          <DescriptionsItem label="更新时间">
            {{ formatDateTime(detail.updatedAt) }}
          </DescriptionsItem>
        </Descriptions>

        <div v-if="detail.jobType === 'artwork'" class="mt-4">
          <Descriptions bordered :column="1" size="small">
            <DescriptionsItem label="交付状态">
              {{ detail.deliveryStatus === 'ready' ? '四方向齐全' : '尚不完整' }}
            </DescriptionsItem>
            <DescriptionsItem label="主题结果">
              {{ detail.themeSelection?.themeJobId }} /
              {{ detail.themeSelection?.resultId }} / 修订
              {{ detail.themeSelection?.selectionRevision }}
            </DescriptionsItem>
            <DescriptionsItem
              v-for="direction in detail.directions"
              :key="direction.direction"
              :label="direction.direction"
            >
              {{ direction.status }} {{ direction.reason }}
            </DescriptionsItem>
            <DescriptionsItem label="生成模型">
              {{ detail.generationSnapshot?.model.model }} / 修订
              {{ detail.generationSnapshot?.model.revision }}
            </DescriptionsItem>
            <DescriptionsItem label="素材用途">
              四面方向底图；清单画面映射及物理尺寸未核实。
            </DescriptionsItem>
          </Descriptions>
        </div>

        <div v-if="detail.sourcePreviewUrl" class="mt-4">
          <div class="mb-2 text-sm font-medium text-gray-500">原图</div>
          <Image :src="detail.sourcePreviewUrl" :width="160" />
        </div>

        <div v-if="detail.results && detail.results.length > 0" class="mt-4">
          <div class="mb-2 text-sm font-medium text-gray-500">AI生成</div>
          <div class="grid grid-cols-4 gap-3">
            <div
              v-for="result in detail.results"
              :key="result.id"
              class="flex flex-col gap-1"
            >
              <Image
                v-if="result.previewUrl"
                :src="result.previewUrl"
                class="h-28 rounded object-contain"
              />
              <div
                v-else
                class="bg-gray-100 flex items-center justify-center text-gray-400 text-xs h-28 rounded"
              >
                无预览
              </div>
              <span class="text-xs text-center text-gray-500">{{ result.direction ?? `#${result.ordinal}` }} ·
                {{ result.width }} × {{ result.height }}</span>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  </Page>
</template>
