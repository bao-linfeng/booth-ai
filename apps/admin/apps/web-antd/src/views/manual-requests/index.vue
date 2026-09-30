<script setup lang="ts">
import type { ManualRequest, ManualStatus } from '#/api/core/manual-requests';

import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import {
  Button,
  Descriptions,
  DescriptionsItem,
  message,
  Modal,
  Tag,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  followUpManualRequestApi,
  getManualRequestApi,
  listManualRequestsApi,
} from '#/api/core/manual-requests';
import { getSchemeOptionsApi } from '#/api/core/schemes';

const statusLabels: Record<ManualStatus, string> = {
  pending: '待处理',
  following_up: '跟进中',
  completed: '已完成',
};
const statuses = Object.entries(statusLabels).map(([value, label]) => ({
  value,
  label,
}));
const detail = ref<ManualRequest>();
const viewOpen = ref(false);
const followUpOpen = ref(false);
const loading = ref(false);
const saving = ref(false);
const optionLabels = ref<Record<string, string>>({});
const requirementLabels: Record<string, string> = {
  lengthMm: '展位长',
  widthMm: '展位宽',
  maxHeightMm: '场馆限高',
  areaM2: '展位面积',
  openingCount: '开口面数',
  productSystemId: '产品体系',
  styleIds: '设计风格',
  industryIds: '适用行业',
  budgetTierId: '材料预算',
  zoneIds: '功能分区',
  featureIds: '特色功能',
  keywords: '关键词',
  requiredZoneIds: '必须分区',
  requiredFeatureIds: '必须特色',
  excludedZoneIds: '禁止分区',
  excludedFeatureIds: '禁止特色',
  applicabilityAnswers: '适用条件',
};
const requirementFields = computed(() => {
  const requirement = detail.value?.requirement;
  if (!requirement) return [];

  return Object.entries(requirementLabels).flatMap(([key, label]) => {
    const value = requirement[key];
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
      return [];
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return [];
    return [{ key, label, value: formatRequirementValue(key, value) }];
  });
});

async function loadOptionLabels() {
  try {
    const options = await getSchemeOptionsApi();
    optionLabels.value = Object.fromEntries(
      Object.values(options)
        .flat()
        .flatMap((item) => [
          [item.id, item.label],
          [item.itemValue, item.label],
        ]),
    );
  } catch {
    optionLabels.value = {};
  }
}

function optionLabel(value: unknown) {
  const stringValue = String(value);
  return optionLabels.value[stringValue] ?? stringValue;
}

function formatRequirementValue(key: string, value: unknown) {
  if (typeof value === 'number') {
    if (['lengthMm', 'maxHeightMm', 'widthMm'].includes(key))
      return `${value / 1000} m`;
    if (key === 'areaM2') return `${value} ㎡`;
    if (key === 'openingCount') return `${value} 面`;
  }
  if (Array.isArray(value)) return value.map(optionLabel);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(
      ([question, answer]) =>
        `${optionLabel(question)}：${answer ? '是' : '否'}`,
    );
  }
  if (['budgetTierId', 'productSystemId'].includes(key))
    return optionLabel(value);
  return String(value);
}

const [FollowUpForm, followUpFormApi] = useVbenForm({
  handleSubmit: async () => {},
  schema: [
    {
      component: 'Select',
      fieldName: 'status',
      label: '跟进状态',
      componentProps: { class: 'w-full', options: statuses },
    },
    {
      component: 'Textarea',
      fieldName: 'followUpNote',
      label: '跟进备注',
      componentProps: {
        maxlength: 2000,
        rows: 5,
        showCount: true,
        class: 'w-full',
        placeholder: '记录联系进展与下一步',
      },
    },
  ],
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'status',
        label: '跟进状态',
        componentProps: { options: statuses, allowClear: true },
      },
    ],
  },
  gridOptions: {
    height: 'auto',
    showOverflow: 'tooltip',
    toolbarConfig: { refresh: true },
    columns: [
      { field: 'contactName', title: '联系人', minWidth: 110 },
      { field: 'contactDetail', title: '联系方式', minWidth: 190 },
      { field: 'originalText', title: '原始需求', minWidth: 240 },
      {
        field: 'schemeContext',
        title: '方案编号',
        minWidth: 140,
        slots: { default: 'scheme' },
      },
      {
        field: 'status',
        title: '跟进状态',
        width: 110,
        slots: { default: 'status' },
      },
      {
        field: 'createdAt',
        title: '提交时间',
        minWidth: 170,
        slots: { default: 'createdAt' },
      },
      {
        field: 'action',
        title: '操作',
        width: 140,
        fixed: 'right',
        slots: { default: 'action' },
      },
    ],
    pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: { status?: ManualStatus } = {},
        ) => {
          const result = await listManualRequestsApi({
            page: page.currentPage,
            pageSize: page.pageSize,
            ...(formValues.status ? { status: formValues.status } : {}),
          });
          return { items: result.data, total: result.total };
        },
      },
    },
  },
});

async function openRequest(row: ManualRequest, mode: 'follow-up' | 'view') {
  viewOpen.value = mode === 'view';
  followUpOpen.value = mode === 'follow-up';
  loading.value = true;
  detail.value = undefined;
  try {
    const record = await getManualRequestApi(row.id);
    if (!viewOpen.value && !followUpOpen.value) return;
    detail.value = record;
    followUpFormApi.resetForm();
    followUpFormApi.setValues({
      status: record.status,
      followUpNote: record.followUpNote,
    });
  } catch {
    viewOpen.value = false;
    followUpOpen.value = false;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!detail.value || saving.value) return;
  saving.value = true;
  try {
    const values = await followUpFormApi.getValues();
    detail.value = await followUpManualRequestApi(detail.value.id, {
      status: values.status as ManualStatus,
      followUpNote: String(values.followUpNote ?? ''),
    });
    message.success('跟进已保存');
    followUpOpen.value = false;
    gridApi.reload();
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadOptionLabels();
});
</script>

<template>
  <Page auto-content-height title="人工需求">
    <Grid>
      <template #scheme="{ row }">
        {{ (row as ManualRequest).schemeContext?.code || '—' }}
      </template>
      <template #status="{ row }">
        <Tag
          :color="
            (row as ManualRequest).status === 'completed'
              ? 'success'
              : (row as ManualRequest).status === 'following_up'
                ? 'processing'
                : 'default'
          "
        >
          {{ statusLabels[(row as ManualRequest).status] }}
        </Tag>
      </template>
      <template #createdAt="{ row }">
        {{ formatDateTime((row as ManualRequest).createdAt) }}
      </template>
      <template #action="{ row }">
        <Button type="link" @click="openRequest(row as ManualRequest, 'view')">
          查看
        </Button>
        <Button
          type="link"
          @click="openRequest(row as ManualRequest, 'follow-up')"
        >
          跟进
        </Button>
      </template>
    </Grid>
    <Modal
      v-model:open="viewOpen"
      title="人工需求详情"
      :width="720"
      :footer="null"
    >
      <div v-if="loading" class="py-6">正在加载需求…</div>
      <div v-else-if="detail">
        <Descriptions bordered :column="1" size="small">
          <DescriptionsItem label="联系人">
            {{ detail.contactName }}
          </DescriptionsItem>
          <DescriptionsItem label="联系方式">
            {{ detail.contactDetail }}
          </DescriptionsItem>
          <DescriptionsItem label="来源">
            {{ detail.userId ? '登录用户' : '匿名访客' }}
          </DescriptionsItem>
          <DescriptionsItem label="提交时间">
            {{ formatDateTime(detail.createdAt) }}
          </DescriptionsItem>
          <DescriptionsItem label="原始文字">
            <span class="whitespace-pre-wrap break-words">{{
              detail.originalText || '—'
            }}</span>
          </DescriptionsItem>
          <DescriptionsItem label="最终条件" :span="1">
            <Descriptions
              v-if="requirementFields.length"
              :column="1"
              size="small"
            >
              <DescriptionsItem
                v-for="field in requirementFields"
                :key="field.key"
                :label="field.label"
              >
                <template v-if="Array.isArray(field.value)">
                  <Tag v-for="item in field.value" :key="item">{{ item }}</Tag>
                </template>
                <span v-else>{{ field.value }}</span>
              </DescriptionsItem>
            </Descriptions>
            <span v-else>未填写结构条件</span>
          </DescriptionsItem>
          <DescriptionsItem label="未解决问题">
            <p
              v-for="question in detail.unresolvedQuestions"
              :key="question"
              class="mb-1"
            >
              {{ question }}
            </p>
            <span v-if="!detail.unresolvedQuestions.length">—</span>
          </DescriptionsItem>
          <DescriptionsItem label="方案编号">
            {{ detail.schemeContext?.code || '—' }}
          </DescriptionsItem>
          <DescriptionsItem label="匹配差异">
            <div
              v-for="(difference, index) in detail.schemeContext?.differences ??
              []"
              :key="index"
              class="mb-2"
            >
              {{ difference.field }}：{{ difference.requested }} →
              {{ difference.actual }}<br />{{ difference.reason }}
            </div>
            <span v-if="!detail.schemeContext?.differences.length">—</span>
          </DescriptionsItem>
          <DescriptionsItem label="方案待确认">
            <p
              v-for="item in detail.schemeContext?.pendingConfirmations ?? []"
              :key="item"
            >
              {{ item }}
            </p>
            <span v-if="!detail.schemeContext?.pendingConfirmations.length">—</span>
          </DescriptionsItem>
        </Descriptions>
      </div>
    </Modal>
    <Modal
      v-model:open="followUpOpen"
      title="人工需求跟进"
      :width="520"
      :confirm-loading="saving"
      :ok-button-props="{ disabled: !detail || loading }"
      @ok="save"
    >
      <div v-if="loading" class="py-6">正在加载需求…</div>
      <div v-else-if="detail" class="space-y-4">
        <Descriptions bordered :column="1" size="small">
          <DescriptionsItem label="联系人">
            {{ detail.contactName }}
          </DescriptionsItem>
          <DescriptionsItem label="原始需求">
            <span class="whitespace-pre-wrap break-words">{{
              detail.originalText || '—'
            }}</span>
          </DescriptionsItem>
        </Descriptions>
        <div class="mt-6">
          <FollowUpForm />
        </div>
        <p v-if="detail.followedBy" class="text-xs text-gray-500">
          最近跟进人：{{ detail.followedBy }} ·
          {{ formatDateTime(detail.updatedAt) }}
        </p>
      </div>
    </Modal>
  </Page>
</template>
