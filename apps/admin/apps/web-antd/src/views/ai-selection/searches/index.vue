<script setup lang="ts">
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SchemeSearchRecord } from '#/api/core/scheme-searches';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Button, Descriptions, DescriptionsItem, Drawer, Tag, Tooltip } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { getSchemeSearchDetailApi, getSchemeSearchListApi, getSchemeSearchVisitorsApi, type SchemeSearchDetail } from '#/api/core/scheme-searches';
import { getSchemeListApi, getSchemeOptionsApi } from '#/api/core/schemes';
import { getUserListApi } from '#/api/core/user-manage';

const detailOpen = ref(false);
const detail = ref<SchemeSearchDetail>();
const detailLoading = ref(false);
const diagnosticLabels: Record<string, string> = {
  unverifiedChecklist: '清单未核验', incompleteAssets: '资产不完整', invalidData: '基础数据或审核信息不完整',
  productSystem: '体系不符', height: '超过限高', applicability: '适用条件不符', tags: '功能条件不符', dimensions: '尺寸超出参考范围',
};
const optionLabels = ref<Record<string, string>>({});
const filterOptions = ref({ users: [] as { label: string; value: string }[], schemes: [] as { label: string; value: string }[], visitors: [] as { label: string; value: string }[] });

const [Grid, GridApi] = useVbenVxeGrid<SchemeSearchRecord>({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'visitorId',
        label: '匿名访客',
        componentProps: { placeholder: '请选择匿名访客', allowClear: true, showSearch: true, options: filterOptions.value.visitors },
      },
      {
        component: 'Select',
        fieldName: 'userId',
        label: '用户',
        componentProps: { placeholder: '请选择用户', allowClear: true, showSearch: true, options: filterOptions.value.users },
      },
      {
        component: 'Select',
        fieldName: 'schemeCode',
        label: '方案 Code',
        componentProps: { placeholder: '请选择方案', allowClear: true, showSearch: true, options: filterOptions.value.schemes },
      },
      {
        component: 'Select',
        fieldName: 'status',
        label: '结果状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '已命中', value: 'matched' },
            { label: '零命中', value: 'no_match' },
            { label: '待澄清', value: 'needs_clarification' },
          ],
          placeholder: '请选择结果状态',
        },
      },
      {
        component: 'Select',
        fieldName: 'mode',
        label: '检索模式',
        componentProps: {
          allowClear: true,
          options: [
            { label: '条件匹配', value: 'filtered' },
            { label: '随机推荐', value: 'random' },
          ],
          placeholder: '请选择检索模式',
        },
      },
    ],
  },
  gridOptions: {
    height: 'auto',
    showOverflow: 'tooltip',
    toolbarConfig: { refresh: true, custom: true, zoom: true },
    columns: [
      { field: 'createdAt', title: '时间', minWidth: 170, slots: { default: 'createdAt' } },
      { field: 'id', title: '检索 ID', width: 230 },
      { field: 'visitorId', title: '匿名访客', width: 190 },
      { field: 'mode', title: '模式', width: 100, slots: { default: 'mode' } },
      { field: 'status', title: '状态', width: 120, slots: { default: 'status' } },
      { field: 'resultCount', title: '结果', width: 80 },
      { field: 'schemeCodes', title: '方案 Code', minWidth: 220, slots: { default: 'schemeCodes' } },
      { field: 'counts', title: '命中结构', width: 150, slots: { default: 'counts' } },
      { field: 'durationMs', title: '耗时', width: 90, slots: { default: 'durationMs' } },
      { field: 'username', title: '用户名/昵称', width: 140, slots: { default: 'username' } },
      { field: 'action', title: '操作', width: 80, fixed: 'right', slots: { default: 'action' } },
    ],
    pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: {
            mode?: SchemeSearchRecord['mode'];
            status?: SchemeSearchRecord['status'];
            visitorId?: string;
            userId?: string;
            schemeCode?: string;
          } = {},
        ) => {
          const result = await getSchemeSearchListApi({
            page: page.currentPage,
            pageSize: page.pageSize,
            mode: formValues.mode,
            status: formValues.status,
            visitorId: formValues.visitorId?.trim() || undefined,
            userId: formValues.userId,
            schemeCode: formValues.schemeCode,
          });
          return { items: result.data, total: result.total };
        },
      },
    },
  } satisfies VxeTableGridOptions<SchemeSearchRecord>,
});

async function loadFilterOptions() {
  const pageSize = 100;
  const [visitors, firstUsers, firstSchemes, schemeOptions] = await Promise.all([
    getSchemeSearchVisitorsApi(),
    getUserListApi({ page: 1, pageSize }),
    getSchemeListApi({ page: 1, pageSize }),
    getSchemeOptionsApi(),
  ]);
  const userPages = Math.ceil(firstUsers.total / pageSize);
  const schemePages = Math.ceil(firstSchemes.total / pageSize);
  const [remainingUsers, remainingSchemes] = await Promise.all([
    Promise.all(Array.from({ length: userPages - 1 }, (_, index) => getUserListApi({ page: index + 2, pageSize }))),
    Promise.all(Array.from({ length: schemePages - 1 }, (_, index) => getSchemeListApi({ page: index + 2, pageSize }))),
  ]);
  filterOptions.value = {
    users: [firstUsers, ...remainingUsers].flatMap((result) => result.data).map((user) => ({
      label: `${user.nickname || user.username} (${user.username})`,
      value: user.id,
    })),
    schemes: [firstSchemes, ...remainingSchemes].flatMap((result) => result.data).map((scheme) => ({
      label: `${scheme.code} ${scheme.name}`,
      value: scheme.code,
    })),
    visitors: visitors.map((visitor) => ({
      label: `${visitor.visitorId} (${visitor.searchCount})`,
      value: visitor.visitorId,
    })),
  };
  optionLabels.value = Object.fromEntries(
    Object.values(schemeOptions).flat().flatMap((option) => [
      [option.id, option.label],
      [option.itemValue, option.label],
    ]),
  );
  GridApi.formApi.updateSchema([
    { fieldName: 'visitorId', componentProps: { options: filterOptions.value.visitors } },
    { fieldName: 'userId', componentProps: { options: filterOptions.value.users } },
    { fieldName: 'schemeCode', componentProps: { options: filterOptions.value.schemes } },
  ]);
}

onMounted(() => {
  void loadFilterOptions();
});

async function openDetail(id: string) {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = undefined;
  try {
    detail.value = await getSchemeSearchDetailApi(id);
  } finally {
    detailLoading.value = false;
  }
}

function statusColor(status: SchemeSearchRecord['status']) {
  if (status === 'matched') return 'success';
  if (status === 'no_match') return 'error';
  return 'warning';
}

const requirementLabels: Record<string, string> = {
  lengthMm: '长度 (mm)',
  widthMm: '宽度 (mm)',
  maxHeightMm: '最大高度 (mm)',
  areaM2: '面积 (m²)',
  openingCount: '开口数',
  productSystemId: '产品系统',
  styleIds: '风格',
  industryIds: '行业',
  budgetTierId: '预算档位',
  zoneIds: '功能区域',
  featureIds: '功能特征',
  keywords: '关键词',
  requiredZoneIds: '必选区域',
  requiredFeatureIds: '必选特征',
  excludedZoneIds: '排除区域',
  excludedFeatureIds: '排除特征',
  applicabilityAnswers: '适用性条件',
};

function requirementValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(requirementOptionLabel).join('、') : '不限';
  if (value === null || value === undefined || value === '') return '不限';
  if (typeof value === 'object') return JSON.stringify(value);
  return requirementOptionLabel(value);
}

function requirementOptionLabel(value: unknown): string {
  const stringValue = String(value);
  return optionLabels.value[stringValue] ?? stringValue;
}
</script>

<template>
  <Page auto-content-height title="检索记录">
    <Grid>
      <template #createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      <template #mode="{ row }">{{ row.mode === 'random' ? '随机推荐' : '条件匹配' }}</template>
      <template #status="{ row }">
        <Tag :color="statusColor(row.status)">
          {{ row.status === 'matched' ? '已命中' : row.status === 'no_match' ? '零命中' : '待澄清' }}
        </Tag>
      </template>
      <template #counts="{ row }">直 {{ row.directCount }} / 参 {{ row.referenceCount }} / 随 {{ row.randomCount }}</template>
      <template #schemeCodes="{ row }">{{ row.schemeCodes?.join('、') || '—' }}</template>
      <template #durationMs="{ row }">{{ row.durationMs }} ms</template>
      <template #username="{ row }">{{ row.username || (row.loggedIn ? '已登录' : '匿名') }}</template>
      <template #action="{ row }">
        <Tooltip title="查看详情">
          <Button type="link" size="small" aria-label="查看检索详情" @click="openDetail(row.id)">
            <span class="icon-[lucide--eye]" />
          </Button>
        </Tooltip>
      </template>
    </Grid>

    <Drawer v-model:open="detailOpen" title="检索流水详情" width="720">
      <div v-if="detailLoading" class="py-8 text-center">正在加载检索详情…</div>
      <Descriptions v-else-if="detail" bordered :column="1" size="small">
        <DescriptionsItem label="检索 ID">{{ detail.id }}</DescriptionsItem>
        <DescriptionsItem label="attemptId">{{ detail.attemptId }}</DescriptionsItem>
        <DescriptionsItem label="parseId">{{ detail.parseId || '—' }}</DescriptionsItem>
        <DescriptionsItem label="visitorId">{{ detail.visitorId }}</DescriptionsItem>
        <DescriptionsItem label="原始需求"><span class="whitespace-pre-wrap break-words">{{ detail.inputText || '未输入文字' }}</span></DescriptionsItem>
        <DescriptionsItem label="筛选条件">
          <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1">
            <template v-for="(value, key) in detail.finalRequirement" :key="key">
              <span class="text-gray-500">{{ requirementLabels[String(key)] || key }}</span>
              <span class="break-words">{{ requirementValue(value) }}</span>
            </template>
          </div>
        </DescriptionsItem>
        <DescriptionsItem label="版本">规则 {{ detail.rulesVersion }} / 字典 {{ detail.dictionaryVersion }}</DescriptionsItem>
        <DescriptionsItem label="解析">{{ detail.parser || '—' }}{{ detail.parseDegraded ? '（降级）' : '' }}</DescriptionsItem>
        <DescriptionsItem label="需求词">{{ detail.demandTerms.join('、') || '—' }}</DescriptionsItem>
        <DescriptionsItem label="零命中原因">{{ detail.zeroMatchReasons.join('；') || '—' }}</DescriptionsItem>
        <DescriptionsItem label="匹配诊断">
          <div v-if="detail.matchDiagnostics" class="space-y-1">
            <div>已发布且审核有效 {{ detail.matchDiagnostics.reviewedPublished }} 套；可用 {{ detail.matchDiagnostics.ready }} 套</div>
            <div v-for="(count, key) in detail.matchDiagnostics.exclusions" :key="key">{{ diagnosticLabels[key] }}：{{ count }} 套</div>
            <div class="text-gray-500">各原因独立计数，可能重叠；条件筛选仅统计可用方案。</div>
          </div>
          <span v-else>—</span>
        </DescriptionsItem>
        <DescriptionsItem label="返回方案快照"><pre class="whitespace-pre-wrap break-words">{{ JSON.stringify(detail.resultSnapshot, null, 2) }}</pre></DescriptionsItem>
      </Descriptions>
    </Drawer>
  </Page>
</template>
