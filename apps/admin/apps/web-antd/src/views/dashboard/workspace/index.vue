<script lang="ts" setup>
import type {
  DashboardWorkspace,
  WorkspaceTaskReason,
} from '#/api/core/dashboard';

import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page, WorkbenchHeader } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { formatDateTime } from '@vben/utils';

import { Alert, Button, Card, Empty, Skeleton, Tag } from 'ant-design-vue';

import { getDashboardWorkspaceApi } from '#/api/core/dashboard';
import { projectEventLabels, statusLabels } from '#/api/core/projects';

type Workspace = NonNullable<DashboardWorkspace['projects']>;
type Activity = Workspace['activities'][number];

const timeZone = 'Asia/Shanghai';
const reasonMeta: Record<
  WorkspaceTaskReason,
  { color: string; label: string }
> = {
  overdue: { color: 'error', label: '逾期跟进' },
  today: { color: 'warning', label: '今日跟进' },
  pending: { color: 'processing', label: '待受理' },
};
const navItems = [
  {
    name: 'ProjectList',
    label: '项目承接',
    icon: 'lucide:clipboard',
    permission: 'projects.read',
  },
  {
    name: 'ProjectNotifications',
    label: '消息通知',
    icon: 'lucide:bell',
    permission: 'notifications.read',
  },
  {
    name: 'SchemeList',
    label: '方案列表',
    icon: 'lucide:layout-template',
    permission: 'schemes.read',
  },
  {
    name: 'BillOfMaterialsManagement',
    label: '清单管理',
    icon: 'lucide:list-checks',
    permission: 'bom.read',
  },
  {
    name: 'GenerationJobs',
    label: '生成任务',
    icon: 'lucide:cpu',
    permission: 'generation.read',
  },
  {
    name: 'AiSelectionSearches',
    label: '检索记录',
    icon: 'lucide:search',
    permission: 'searches.read',
  },
  {
    name: 'AiSelectionAnalytics',
    label: '智选统计',
    icon: 'lucide:chart-line',
    permission: 'search-analytics.read',
  },
  {
    name: 'UserList',
    label: '用户列表',
    icon: 'lucide:users',
    permission: 'users.read',
  },
  {
    name: 'Analytics',
    label: '分析页',
    icon: 'lucide:area-chart',
    permission: 'dashboard.read',
  },
];

const router = useRouter();
const userStore = useUserStore();
const { hasAccessByCodes } = useAccess();
const workspace = ref<DashboardWorkspace>();
const loading = ref(false);
const failed = ref(false);

const quickLinks = computed(() =>
  navItems.filter(
    (item) => hasAccessByCodes([item.permission]) && router.hasRoute(item.name),
  ),
);
const canViewProjectDetail = computed(() => router.hasRoute('ProjectDetail'));
const greeting = computed(() => {
  const hour = Number(
    new Intl.DateTimeFormat('zh-CN', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date()),
  );
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
});
const today = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'full',
  timeZone,
}).format(new Date());
const summaryText = computed(() => {
  const projects = workspace.value?.projects;
  if (!projects) return '从快捷入口开始今天的工作。';
  if (!projects.taskTotal)
    return '您负责的项目暂无逾期、今日到期或待受理事项。';
  const parts = [
    projects.overdueFollowUps && `${projects.overdueFollowUps} 项逾期跟进`,
    projects.todayFollowUps && `${projects.todayFollowUps} 项今日跟进`,
    projects.pending && `${projects.pending} 项待受理`,
  ].filter(Boolean);
  return `您负责的项目中有 ${parts.join('、')}，请及时处理。`;
});
const headerStats = computed(() => {
  const data = workspace.value;
  if (!data) return [];
  return [
    ...(data.projects
      ? [
          { label: '需处理', value: data.projects.taskTotal },
          { label: '我负责的进行中项目', value: data.projects.active },
        ]
      : []),
    ...(data.notifications
      ? [{ label: '未读消息', value: data.notifications.unread }]
      : []),
  ];
});
const myMetrics = computed(() => {
  const projects = workspace.value?.projects;
  if (!projects) return [];
  return [
    { label: '待受理', value: projects.pending },
    { label: '今日计划跟进', value: projects.todayFollowUps },
    { label: '逾期跟进', value: projects.overdueFollowUps },
  ];
});

function actorLabel(activity: Activity) {
  if (activity.byMe) return '我';
  if (activity.actorName) return activity.actorName;
  return activity.kind === 'accepted' ? '客户' : '系统';
}
function activityText(activity: Activity) {
  switch (activity.kind) {
    case 'accepted': {
      return '提交了项目申请';
    }
    case 'assignment': {
      return '调整了承接人';
    }
    case 'follow-up': {
      return activity.fromStatus &&
        activity.toStatus &&
        activity.fromStatus !== activity.toStatus
        ? `记录跟进，状态由“${statusLabels[activity.fromStatus]}”变为“${statusLabels[activity.toStatus]}”`
        : '记录了联系跟进';
    }
    case 'quotation': {
      return activity.quotationRevision
        ? `保存了第 ${activity.quotationRevision} 版报价`
        : '保存了报价修订';
    }
    case 'scheme': {
      return activity.schemeCode
        ? `确认关联方案 ${activity.schemeCode}`
        : '确认关联方案';
    }
    default: {
      return projectEventLabels[activity.kind] ?? activity.kind;
    }
  }
}
function taskCustomer(task: Workspace['tasks'][number]) {
  return task.company || task.contactName || '未填写客户';
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  workspace.value = undefined;
  try {
    workspace.value = await getDashboardWorkspaceApi();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Page>
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        {{ greeting }}，{{ userStore.userInfo?.realName }}
      </template>
      <template #description>
        {{ today }} · {{ loading ? '正在加载今日待办…' : summaryText }}
      </template>
      <template #actions>
        <dl class="mb-0 flex gap-10 md:mr-6">
          <div
            v-for="item in headerStats"
            :key="item.label"
            class="flex flex-col justify-center text-right"
          >
            <dt class="text-foreground/80">{{ item.label }}</dt>
            <dd class="mb-0 text-2xl tabular-nums">
              {{ item.value.toLocaleString() }}
            </dd>
          </div>
        </dl>
      </template>
    </WorkbenchHeader>

    <Alert
      v-if="failed"
      type="error"
      show-icon
      class="mt-4"
      message="工作台数据加载失败"
      description="未能取得您的待办与动态，请重试。"
    >
      <template #action>
        <Button size="small" @click="load">重新加载</Button>
      </template>
    </Alert>

    <div class="mt-4 flex flex-col gap-4 lg:flex-row">
      <div class="flex w-full flex-col gap-4 lg:w-3/5">
        <Card
          v-if="loading || workspace?.projects"
          title="我的待办"
          :body-style="{ paddingTop: '8px' }"
        >
          <template #extra>
            <Button size="small" :loading="loading" @click="load">
              刷新我的待办
            </Button>
          </template>
          <Skeleton v-if="loading" active />
          <template v-else-if="workspace?.projects">
            <ul
              v-if="workspace.projects.tasks.length"
              class="mb-0 divide-y divide-border pl-0"
            >
              <li
                v-for="task in workspace.projects.tasks"
                :key="task.projectId"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
              >
                <Tag :color="reasonMeta[task.reason].color" class="mr-0">
                  {{ reasonMeta[task.reason].label }}
                </Tag>
                <RouterLink
                  v-if="canViewProjectDetail"
                  :to="{
                    name: 'ProjectDetail',
                    params: { projectId: task.projectId },
                  }"
                  class="text-primary font-medium underline underline-offset-4"
                >
                  {{ task.projectNo }}
                </RouterLink>
                <span v-else class="font-medium">{{ task.projectNo }}</span>
                <span>{{ taskCustomer(task) }}</span>
                <span
                  v-if="task.exhibitionName"
                  class="text-muted-foreground text-sm"
                >
                  {{ task.exhibitionName }}
                </span>
                <span class="text-muted-foreground ml-auto text-sm">
                  {{ statusLabels[task.status] }} ·
                  {{
                    task.nextFollowUpAt
                      ? `计划跟进 ${formatDateTime(task.nextFollowUpAt)}`
                      : `受理于 ${formatDateTime(task.createdAt)}`
                  }}
                </span>
              </li>
            </ul>
            <Empty
              v-else
              description="暂无逾期、今日到期或待受理的项目"
              class="my-6"
            />
            <p class="text-muted-foreground mb-0 mt-3 text-sm">
              <template
                v-if="
                  workspace.projects.taskTotal > workspace.projects.tasks.length
                "
              >
                共 {{ workspace.projects.taskTotal }} 项，仅显示最紧急的
                {{ workspace.projects.tasks.length }} 项。
              </template>
              按逾期、今日跟进、待受理排序；跟进时间取项目最新跟进记录的约定时间。
            </p>
          </template>
        </Card>

        <Card v-if="workspace?.projects" title="我负责项目的最新动态">
          <ol
            v-if="workspace.projects.activities.length"
            class="mb-0 flex flex-col gap-4 pl-0"
          >
            <li
              v-for="activity in workspace.projects.activities"
              :key="activity.id"
              class="flex flex-wrap items-baseline gap-x-2"
            >
              <span class="font-medium">{{ actorLabel(activity) }}</span>
              <span>{{ activityText(activity) }}</span>
              <RouterLink
                v-if="canViewProjectDetail"
                :to="{
                  name: 'ProjectDetail',
                  params: { projectId: activity.projectId },
                }"
                class="text-primary underline underline-offset-4"
              >
                {{ activity.projectNo }}
              </RouterLink>
              <span v-else>{{ activity.projectNo }}</span>
              <time
                :datetime="activity.createdAt"
                class="text-muted-foreground ml-auto text-sm"
              >
                {{ formatDateTime(activity.createdAt) }}
              </time>
            </li>
          </ol>
          <Empty v-else description="暂无项目动态" class="my-6" />
        </Card>
      </div>

      <div class="flex w-full flex-col gap-4 lg:w-2/5">
        <Card title="快捷入口">
          <nav
            v-if="quickLinks.length"
            aria-label="业务快捷入口"
            class="grid grid-cols-3 gap-2"
          >
            <RouterLink
              v-for="item in quickLinks"
              :key="item.name"
              :to="{ name: item.name }"
              class="hover:bg-accent flex flex-col items-center gap-2 rounded-md py-4 text-foreground"
            >
              <IconifyIcon :icon="item.icon" class="text-primary size-6" />
              <span class="text-sm">{{ item.label }}</span>
            </RouterLink>
          </nav>
          <p v-else class="text-muted-foreground mb-0">
            当前账号暂无业务页面权限，请联系管理员配置。
          </p>
        </Card>

        <Card v-if="workspace?.projects" title="我负责的项目">
          <dl class="mb-0 grid grid-cols-3 gap-4">
            <div v-for="item in myMetrics" :key="item.label">
              <dt class="text-muted-foreground text-sm">{{ item.label }}</dt>
              <dd class="mb-0 mt-2 text-2xl font-semibold tabular-nums">
                {{ item.value.toLocaleString() }}
              </dd>
            </div>
          </dl>
          <p class="text-muted-foreground mb-0 mt-4 text-sm">
            统计您作为承接人的未结束项目；今日按上海时区，今日计划与逾期可能重叠。
          </p>
        </Card>

        <Card v-if="workspace?.notifications" title="消息通知">
          <p class="mb-0">
            您有
            <strong class="tabular-nums">
              {{ workspace.notifications.unread.toLocaleString() }}
            </strong>
            条未读项目消息。
            <RouterLink
              v-if="router.hasRoute('ProjectNotifications')"
              :to="{ name: 'ProjectNotifications' }"
              class="text-primary underline underline-offset-4"
            >
              前往查看
            </RouterLink>
          </p>
        </Card>
      </div>
    </div>

    <p
      v-if="workspace"
      class="text-muted-foreground mb-0 mt-3 text-right text-sm"
    >
      数据更新于 {{ formatDateTime(workspace.generatedAt) }}
    </p>
  </Page>
</template>
