<script setup lang="ts">
import type { MatchingSummary, ProjectDetail } from '#/api/core/projects';

import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { formatDateTime, openWindow } from '@vben/utils';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Tag,
  Timeline,
  TimelineItem,
} from 'ant-design-vue';

import {
  assetDownloadApi,
  assigneeStatusLabels,
  getProjectApi,
  statusLabels,
} from '#/api/core/projects';

import CustomerServiceCard from './CustomerServiceCard.vue';
import OperationModal from './OperationModal.vue';
import {
  eventSummary,
  matchTypeLabels,
  requirementSummary,
} from './presentation';
import QuotationEditor from './QuotationEditor.vue';
const route = useRoute();
const router = useRouter();
const project = ref<ProjectDetail>();
const loading = ref(false);
const error = ref('');
const operation = ref<InstanceType<typeof OperationModal>>();
const terminal = computed(
  () =>
    project.value && ['closed', 'lost', 'won'].includes(project.value.status),
);
const assets = computed(() => [
  ...(project.value?.schemeSnapshot?.renderings ?? []),
  ...(project.value?.schemeSnapshot?.selectedTheme
    ? [project.value.schemeSnapshot.selectedTheme.asset]
    : []),
  ...(project.value?.materials.drawings?.assets ?? []),
  ...(project.value?.materials.artworks?.assets ?? []),
]);
const matchTypeColors: Record<MatchingSummary['matchType'], string> = {
  direct: 'green',
  reference: 'orange',
  random: 'blue',
  unmatched: 'red',
};
const eventColors: Record<string, string> = {
  accepted: 'green',
  assignment: 'orange',
  quotation: 'blue',
  scheme: 'blue',
};
const requirementItems = computed(() =>
  project.value
    ? requirementSummary(
        project.value.request.confirmedRequirements ??
          project.value.request.requirementContext?.confirmedRequirements,
        project.value.requirementOptionLabels,
      )
    : [],
);
const pendingItems = computed(() => [
  ...(project.value?.request.matchingSummary?.pendingConfirmations.map(
    (item) => item.message,
  ) ?? []),
  ...(project.value?.request.unresolvedQuestions ?? []),
]);
const timeline = computed(
  () =>
    project.value?.events.map((event) => ({
      ...event,
      ...eventSummary(event),
    })) ?? [],
);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    project.value = await getProjectApi(String(route.params.projectId));
  } catch {
    error.value = '项目读取失败，请重试。';
  } finally {
    loading.value = false;
  }
}
async function download(version: string) {
  if (!project.value) return;
  const result = await assetDownloadApi(project.value.projectId, version);
  openWindow(result.downloadUrl);
}
onMounted(load);
</script>
<template>
  <Page title="项目工作区" content-class="flex flex-col gap-5">
    <Button class="self-start" @click="router.push('/projects')">
      返回项目列表
    </Button>
    <p v-if="loading">正在加载项目…</p>
    <div v-if="error" role="alert">
      <p>{{ error }}</p>
      <Button @click="load">重新加载</Button>
    </div>
    <template v-if="project">
      <Alert
        v-if="project.assigneeStatus !== 'active'"
        type="warning"
        show-icon
        :message="`承接人${assigneeStatusLabels[project.assigneeStatus]} · ${project.assigneeName}`"
        :description="
          terminal
            ? '已结束项目保留历史负责人；如需继续处理，请先重开项目，再由有分配权限的人员改派。'
            : '项目已受理，原负责人及历史记录保留。该人员不能继续跟进，请由有分配权限的人员改派。'
        "
      />
      <Card :title="`${project.projectNo} · ${statusLabels[project.status]}`">
        <template #extra>
          <div class="flex flex-wrap gap-2">
            <Button
              :disabled="terminal"
              @click="operation?.open(project, 'assignment')"
              v-access:code="['projects.assign']"
            >
              改派
            </Button>
            <Button
              v-access:code="['projects.follow-up']"
              @click="operation?.open(project, 'follow-up')"
            >
              追加跟进
            </Button>
            <Button
              v-if="
                project.sourceType === 'manual_request' && !project.schemeCode
              "
              :disabled="terminal"
              @click="operation?.open(project, 'scheme')"
              v-access:code="['projects.link-scheme']"
            >
              确认关联方案
            </Button>
            <Button @click="load">刷新项目</Button>
          </div>
        </template>
        <Descriptions bordered :column="2" size="small">
          <DescriptionsItem label="来源">
            {{
              project.sourceType === 'quote_request' ? '报价申请' : '人工需求'
            }}
            / {{ project.request.entryPoint }}
          </DescriptionsItem>
          <DescriptionsItem label="项目修订">
            {{ project.revision }}
          </DescriptionsItem>
          <DescriptionsItem label="承接人">
            {{ project.assigneeName }}
          </DescriptionsItem>
          <DescriptionsItem label="渠道归属">
            {{ project.attribution }}
          </DescriptionsItem>
          <DescriptionsItem label="客户 / 联系人">
            {{ project.request.company }} /
            {{ project.request.contact.name }}
            <Tag v-if="!project.customerUserId" color="orange" class="ml-2">
              未关联客户账号
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="联系方式">
            {{ project.request.contact.email }}
            {{ project.request.contact.phone }}
            {{ project.request.contact.legacyDetail }}
          </DescriptionsItem>
          <DescriptionsItem label="展会">
            {{ project.request.exhibition?.name ?? '历史资料待补' }}
          </DescriptionsItem>
          <DescriptionsItem label="国家 / 城市">
            {{ project.request.exhibition?.countryCode }}
            {{ project.request.exhibition?.city }}
          </DescriptionsItem>
          <DescriptionsItem label="展会日期">
            {{ project.request.exhibition?.startDate }} 至
            {{ project.request.exhibition?.endDate }}
          </DescriptionsItem>
          <DescriptionsItem label="材料预算">
            {{ project.request.materialBudget?.currency }}
            {{ project.request.materialBudget?.amount }}
          </DescriptionsItem>
          <DescriptionsItem label="需求范围">
            {{ project.request.scopeCodes?.join('、') }}
            {{ project.request.scopeNotes }}
          </DescriptionsItem>
          <DescriptionsItem label="已关联方案">
            {{ project.schemeCode ?? '未关联' }} /
            {{ project.schemeSnapshot?.name }}
          </DescriptionsItem>
          <DescriptionsItem label="原始需求" :span="2">
            <span class="whitespace-pre-wrap">{{
              project.request.originalDescription ??
              project.request.requirementContext?.originalDescription ??
              '—'
            }}</span>
          </DescriptionsItem>
          <DescriptionsItem label="确认条件" :span="2">
            <div v-if="requirementItems.length" class="flex flex-wrap gap-2">
              <Tag v-for="item in requirementItems" :key="item.label">
                {{ item.label }}：{{ item.value }}
              </Tag>
            </div>
            <span v-else class="text-muted-foreground">未提供筛选条件</span>
          </DescriptionsItem>
          <DescriptionsItem label="参考差异 / 待确认" :span="2">
            <template v-if="project.request.matchingSummary">
              <Tag
                :color="
                  matchTypeColors[project.request.matchingSummary.matchType]
                "
              >
                {{ matchTypeLabels[project.request.matchingSummary.matchType] }}
              </Tag>
              <ul
                v-if="project.request.matchingSummary.differences.length"
                class="mt-2 list-disc pl-5"
              >
                <li
                  v-for="item in project.request.matchingSummary.differences"
                  :key="item.field"
                >
                  客户要求 {{ item.requested }}，方案为 {{ item.actual }}
                  <span class="text-muted-foreground">
                    （{{ item.reason }}）
                  </span>
                </li>
              </ul>
            </template>
            <ul v-if="pendingItems.length" class="mt-2 list-disc pl-5">
              <li v-for="item in pendingItems" :key="item">
                待确认：{{ item }}
              </li>
            </ul>
            <span
              v-if="
                !pendingItems.length &&
                !project.request.matchingSummary?.differences.length
              "
              class="text-muted-foreground"
            >
              {{
                project.request.matchingSummary ? '与确认条件一致，' : ''
              }}无待确认事项
            </span>
          </DescriptionsItem>
          <DescriptionsItem label="补充说明" :span="2">
            {{ project.request.notes ?? '—' }}
          </DescriptionsItem>
          <DescriptionsItem label="资料快照">
            清单 {{ project.materials.bom?.status ?? 'missing' }} / 图纸
            {{ project.materials.drawings?.status ?? 'missing' }} / 素材
            {{ project.materials.artworks?.status ?? 'missing' }}
          </DescriptionsItem>
          <DescriptionsItem label="客户公开结果">
            {{ project.publicResult ?? '尚未发布' }}
          </DescriptionsItem>
        </Descriptions>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button
            v-for="asset in assets"
            :key="asset.versionId"
            size="small"
            @click="download(asset.versionId)"
            v-access:code="['projects.asset-download']"
          >
            固定资料：{{ asset.name }}
          </Button>
        </div>
      </Card>
      <QuotationEditor :project="project" @reload="load" />
      <CustomerServiceCard :project-id="project.projectId" />
      <Card title="项目时间线">
        <Timeline>
          <TimelineItem
            v-for="item in timeline"
            :key="item.id"
            :color="eventColors[item.kind] ?? 'gray'"
          >
            <div class="flex flex-wrap items-baseline gap-x-3">
              <span class="font-medium">{{ item.title }}</span>
              <span class="text-xs text-muted-foreground">
                {{ item.actorName ?? '系统' }} ·
                {{ formatDateTime(item.createdAt) }}
              </span>
            </div>
            <dl
              v-if="item.lines.length"
              class="mt-1 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
            >
              <template v-for="line in item.lines" :key="line.label">
                <dt class="text-muted-foreground">{{ line.label }}</dt>
                <dd class="whitespace-pre-wrap break-words">
                  {{ line.value }}
                </dd>
              </template>
            </dl>
          </TimelineItem>
        </Timeline>
      </Card>
    </template>
    <OperationModal ref="operation" @reload="load" />
  </Page>
</template>
