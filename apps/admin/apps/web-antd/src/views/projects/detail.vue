<script setup lang="ts">
import type {
  MatchingSummary,
  ProjectAssetImage,
  ProjectDetail,
  ProjectStatus,
} from '#/api/core/projects';

import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { formatDateTime, openWindow } from '@vben/utils';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Image,
  ImagePreviewGroup,
  TabPane,
  Tabs,
  Tag,
  Timeline,
  TimelineItem,
  Tooltip,
} from 'ant-design-vue';

import {
  assetDownloadApi,
  assetImagesApi,
  assigneeStatusLabels,
  getProjectApi,
  poolReasonLabels,
  statusLabels,
} from '#/api/core/projects';

import AssignModal from './AssignModal.vue';
import { claimProject } from './claim';
import CustomerServiceCard from './CustomerServiceCard.vue';
import OperationModal from './OperationModal.vue';
import {
  entryPointLabels,
  eventSummary,
  followUpUrgency,
  isImageAsset,
  matchTypeLabels,
  materialStatusLabels,
  requirementSummary,
  scopeLabels,
  statusColors,
  terminalStatuses,
} from './presentation';
import PublicResultModal from './PublicResultModal.vue';
import QuotationEditor from './QuotationEditor.vue';
const route = useRoute();
const { hasAccessByCodes } = useAccess();
const router = useRouter();
const project = ref<ProjectDetail>();
const loading = ref(false);
const error = ref('');
const operation = ref<InstanceType<typeof OperationModal>>();
const assign = ref<InstanceType<typeof AssignModal>>();
/** 标签页默认打开时间线；概览中的图片地址在首次进入概览时再请求 */
const activeTab = ref('timeline');
const overviewVisited = ref(false);
const claiming = ref(false);
const unassigned = computed(
  () => !!project.value && !project.value.assigneeAdminId,
);
const unassignedHint = '待分配项目需先分配承接人';
/** 受理时进入待分配池的原因（取自受理事件） */
const poolReason = computed(() => {
  const accepted = project.value?.events.find(
    (event) => event.kind === 'accepted',
  );
  return poolReasonLabels[String(accepted?.payload.poolReason)];
});
const terminal = computed(
  () => !!project.value && terminalStatuses.includes(project.value.status),
);
const publicResult = ref<InstanceType<typeof PublicResultModal>>();
/** 人工需求可关联方案；已关联的在未结束且还没有报价修订时可重新关联 */
const canLinkScheme = computed(
  () =>
    project.value?.sourceType === 'manual_request' &&
    (!project.value.schemeCode ||
      (!terminal.value && project.value.quotation === null)),
);
/** 头部快捷操作：打开跟进弹窗并预选目标状态，按当前可选状态显示；终态的重开仍走「追加跟进」 */
const quickActions: { label: string; status: ProjectStatus }[] = [
  { label: '开始跟进', status: 'following' },
  { label: '标记成交', status: 'won' },
  { label: '标记未成交', status: 'lost' },
  { label: '关闭项目', status: 'closed' },
];
const availableQuickActions = computed(() => {
  const transitions = project.value?.statusTransitions;
  return transitions && !terminal.value
    ? quickActions.filter((action) => transitions.includes(action.status))
    : [];
});
const assetGroups = computed(() => {
  const theme = project.value?.schemeSnapshot?.selectedTheme;
  return [
    {
      label: '效果图',
      assets: project.value?.schemeSnapshot?.renderings ?? [],
    },
    { label: 'AI 换主题结果', assets: theme ? [theme.asset] : [] },
    { label: '图纸', assets: project.value?.materials.drawings?.assets ?? [] },
    { label: '素材', assets: project.value?.materials.artworks?.assets ?? [] },
  ]
    .filter((group) => group.assets.length > 0)
    .map((group) => ({
      label: group.label,
      images: group.assets.filter((asset) => isImageAsset(asset)),
      files: group.assets.filter((asset) => !isImageAsset(asset)),
    }));
});
/** 图片资料的缩略图与预览图地址，按 versionId 索引；取址失败的图片退回下载按钮。 */
const imageUrls = ref<Record<string, ProjectAssetImage>>({});
let imageLoad = 0;
const downloadOnly = (group: (typeof assetGroups.value)[number]) => [
  ...group.images.filter((asset) => !imageUrls.value[asset.versionId]),
  ...group.files,
];
const scopeText = computed(() =>
  project.value?.request.scopeCodes
    ?.map((code) => scopeLabels[code] ?? code)
    .join('、'),
);
const materialStatus = (status?: string) =>
  materialStatusLabels[status ?? 'missing'] ?? status;
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
  if (project.value && overviewVisited.value)
    await loadImageUrls(project.value.projectId);
}
watch(activeTab, async (tab) => {
  if (tab !== 'overview' || overviewVisited.value) return;
  overviewVisited.value = true;
  if (project.value) await loadImageUrls(project.value.projectId);
});
async function loadImageUrls(projectId: string) {
  const current = ++imageLoad;
  imageUrls.value = {};
  if (!hasAccessByCodes(['projects.asset-download'])) return;
  if (!assetGroups.value.some((group) => group.images.length > 0)) return;
  let images: ProjectAssetImage[];
  try {
    images = await assetImagesApi(projectId);
  } catch {
    return;
  }
  if (current !== imageLoad) return;
  imageUrls.value = Object.fromEntries(
    images.map((image) => [image.versionId, image]),
  );
}
async function claim() {
  if (!project.value || claiming.value) return;
  claiming.value = true;
  try {
    if (await claimProject(project.value.projectId)) await load();
  } finally {
    claiming.value = false;
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
        v-if="unassigned"
        type="warning"
        show-icon
        message="项目待分配"
        :description="`${poolReason ? `受理时${poolReason}，` : ''}项目进入待分配池。分配承接人或领取后才能跟进、报价和关联方案。`"
      />
      <Alert
        v-else-if="project.assigneeStatus !== 'active'"
        type="warning"
        show-icon
        :message="`承接人${assigneeStatusLabels[project.assigneeStatus]} · ${project.assigneeName}`"
        :description="
          terminal
            ? '已结束项目保留历史负责人；可直接改派，无需重开。'
            : '项目已受理，原负责人及历史记录保留。该人员不能继续跟进，请由有分配权限的人员改派。'
        "
      />
      <Card>
        <template #title>
          {{ project.projectNo }}
          <Tag :color="statusColors[project.status]" class="ml-2">
            {{ statusLabels[project.status] }}
          </Tag>
        </template>
        <template #extra>
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="unassigned"
              type="primary"
              :loading="claiming"
              @click="claim"
              v-access:code="['projects.follow-up']"
            >
              分配给我
            </Button>
            <Button
              @click="assign?.open(project)"
              v-access:code="['projects.assign']"
            >
              {{ unassigned ? '分配' : '改派' }}
            </Button>
            <template v-if="!unassigned">
              <Button
                v-for="action in availableQuickActions"
                :key="action.status"
                v-access:code="['projects.follow-up']"
                @click="
                  operation?.open(project, 'follow-up', {
                    targetStatus: action.status,
                  })
                "
              >
                {{ action.label }}
              </Button>
            </template>
            <Tooltip :title="unassigned ? unassignedHint : undefined">
              <Button
                :disabled="unassigned"
                v-access:code="['projects.follow-up']"
                @click="operation?.open(project, 'follow-up')"
              >
                追加跟进
              </Button>
            </Tooltip>
            <Tooltip
              v-if="canLinkScheme"
              :title="unassigned ? unassignedHint : undefined"
            >
              <Button
                :disabled="terminal || unassigned"
                @click="operation?.open(project, 'scheme')"
                v-access:code="['projects.link-scheme']"
              >
                {{ project.schemeCode ? '重新关联方案' : '确认关联方案' }}
              </Button>
            </Tooltip>
            <Button @click="load">刷新项目</Button>
          </div>
        </template>
        <Descriptions bordered :column="3" size="small" data-test="summary">
          <DescriptionsItem label="状态">
            {{ statusLabels[project.status] }}
          </DescriptionsItem>
          <DescriptionsItem label="承接人">
            <Tag v-if="unassigned" color="orange">待分配</Tag>
            <template v-else>{{ project.assigneeName }}</template>
          </DescriptionsItem>
          <DescriptionsItem label="客户">
            {{ project.request.company || project.request.contact.name || '—' }}
          </DescriptionsItem>
          <DescriptionsItem label="展会">
            {{ project.request.exhibition?.name ?? '历史资料待补' }}
          </DescriptionsItem>
          <DescriptionsItem label="材料预算">
            {{
              project.request.materialBudget
                ? `${project.request.materialBudget.currency} ${project.request.materialBudget.amount}`
                : '待补'
            }}
          </DescriptionsItem>
          <DescriptionsItem label="下次跟进">
            <span
              v-if="project.nextFollowUpAt"
              :class="{
                'text-red-500': followUpUrgency(project) === 'overdue',
                'text-orange-500': followUpUrgency(project) === 'today',
              }"
            >
              {{ formatDateTime(project.nextFollowUpAt) }}
            </span>
            <template v-else>—</template>
          </DescriptionsItem>
        </Descriptions>
      </Card>
      <Tabs v-model:active-key="activeTab">
        <TabPane key="overview" tab="概览">
          <Card>
            <Descriptions bordered :column="2" size="small">
              <DescriptionsItem label="来源">
                {{
                  project.sourceType === 'quote_request'
                    ? '报价申请'
                    : '人工需求'
                }}
                <template v-if="project.request.entryPoint">
                  /
                  {{
                    entryPointLabels[project.request.entryPoint] ??
                    project.request.entryPoint
                  }}
                </template>
              </DescriptionsItem>
              <DescriptionsItem label="项目修订">
                {{ project.revision }}
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
                {{ scopeText || '—' }}
                <div
                  v-if="project.request.scopeNotes"
                  class="whitespace-pre-wrap text-muted-foreground"
                >
                  范围说明：{{ project.request.scopeNotes }}
                </div>
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
                <div
                  v-if="requirementItems.length"
                  class="flex flex-wrap gap-2"
                >
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
                    {{
                      matchTypeLabels[project.request.matchingSummary.matchType]
                    }}
                  </Tag>
                  <ul
                    v-if="project.request.matchingSummary.differences.length"
                    class="mt-2 list-disc pl-5"
                  >
                    <li
                      v-for="item in project.request.matchingSummary
                        .differences"
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
                清单{{ materialStatus(project.materials.bom?.status) }} / 图纸{{
                  materialStatus(project.materials.drawings?.status)
                }}
                / 素材{{ materialStatus(project.materials.artworks?.status) }}
              </DescriptionsItem>
              <DescriptionsItem label="客户公开结果">
                <span class="whitespace-pre-wrap">{{
                  project.publicResult ?? '尚未发布'
                }}</span>
                <Button
                  size="small"
                  class="ml-2"
                  v-access:code="['projects.follow-up']"
                  @click="publicResult?.open(project)"
                >
                  更新客户进度
                </Button>
              </DescriptionsItem>
            </Descriptions>
            <section
              v-for="group in assetGroups"
              :key="group.label"
              class="mt-4"
              :data-asset-group="group.label"
            >
              <h4 class="mb-2 text-sm font-medium">{{ group.label }}</h4>
              <ImagePreviewGroup>
                <div class="flex flex-wrap gap-3">
                  <template
                    v-for="asset in group.images"
                    :key="asset.versionId"
                  >
                    <figure v-if="imageUrls[asset.versionId]" class="m-0 w-40">
                      <Image
                        :src="imageUrls[asset.versionId]!.thumbnailUrl"
                        :preview="{
                          src: imageUrls[asset.versionId]!.previewUrl,
                        }"
                        :alt="asset.name"
                        :width="160"
                        :height="110"
                        class="asset-thumb"
                      />
                      <figcaption
                        class="mt-1 truncate text-xs text-muted-foreground"
                        :title="asset.name"
                      >
                        {{ asset.name }}
                      </figcaption>
                    </figure>
                  </template>
                </div>
              </ImagePreviewGroup>
              <div
                v-if="downloadOnly(group).length"
                class="mt-2 flex flex-wrap gap-2"
              >
                <Button
                  v-for="asset in downloadOnly(group)"
                  :key="asset.versionId"
                  size="small"
                  @click="download(asset.versionId)"
                  v-access:code="['projects.asset-download']"
                >
                  下载：{{ asset.name }}
                </Button>
              </div>
            </section>
          </Card>
        </TabPane>
        <TabPane key="quotation" tab="报价">
          <QuotationEditor :project="project" @reload="load" />
        </TabPane>
        <TabPane key="timeline" tab="时间线">
          <Card>
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
        </TabPane>
        <TabPane key="customer-service" tab="客服会话">
          <CustomerServiceCard :project-id="project.projectId" />
        </TabPane>
      </Tabs>
    </template>
    <OperationModal ref="operation" @reload="load" />
    <AssignModal ref="assign" @reload="load" />
    <PublicResultModal ref="publicResult" @reload="load" />
  </Page>
</template>
<style scoped>
.asset-thumb :deep(.ant-image-img) {
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
</style>
