import type { App } from 'vue';

import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  workspace: vi.fn(),
}));
vi.mock('#/api/core/dashboard', () => ({
  getDashboardWorkspaceApi: mocks.workspace,
}));
vi.mock('#/api/core/projects', () => ({
  projectEventLabels: { legacy_import: '历史迁入' },
  statusLabels: {
    following: '跟进中',
    pending: '待跟进',
    quoted: '已报价',
  },
}));
vi.mock('@vben/access', () => ({
  useAccess: () => ({
    hasAccessByCodes: (codes: string[]) =>
      codes.some((code) => mocks.permissions.includes(code)),
  }),
}));
vi.mock('@vben/utils', () => ({ formatDateTime: (value: string) => value }));
vi.mock('@vben/icons', () => ({
  IconifyIcon: defineComponent(() => () => h('i')),
}));
vi.mock('@vben/preferences', () => ({
  preferences: { app: { defaultAvatar: '' } },
}));
vi.mock('@vben/stores', () => ({
  useUserStore: () => ({ userInfo: { realName: '张三', avatar: '' } }),
}));
vi.mock('@vben/common-ui', () => ({
  Page: defineComponent(
    (_, { slots }) =>
      () =>
        h('main', slots.default?.()),
  ),
  WorkbenchHeader: defineComponent(
    (_, { slots }) =>
      () =>
        h('header', [
          slots.title?.(),
          slots.description?.(),
          slots.actions?.(),
        ]),
  ),
}));
vi.mock('ant-design-vue', () => {
  const Passthrough = defineComponent(
    (_, { slots }) =>
      () =>
        h('div', slots.default?.()),
  );
  return {
    Alert: defineComponent({
      props: ['message', 'description'],
      setup:
        (props, { slots }) =>
        () =>
          h('div', [`${props.message} ${props.description}`, slots.action?.()]),
    }),
    Button: defineComponent(
      (_, { slots, attrs }) =>
        () =>
          h('button', attrs, slots.default?.()),
    ),
    Card: defineComponent({
      props: ['title'],
      setup:
        (props, { slots }) =>
        () =>
          h('section', [props.title, slots.extra?.(), slots.default?.()]),
    }),
    Empty: defineComponent({
      props: ['description'],
      setup: (props) => () => h('div', props.description),
    }),
    Skeleton: defineComponent(() => () => h('div', '加载中')),
    Tag: Passthrough,
  };
});

import Workspace from './index.vue';

const workspaceData = {
  generatedAt: '2026-10-07T01:00:00Z',
  timeZone: 'Asia/Shanghai',
  projects: {
    active: 3,
    pending: 1,
    todayFollowUps: 1,
    overdueFollowUps: 1,
    taskTotal: 12,
    tasks: [
      {
        projectId: 'overdue-id',
        projectNo: 'PJ-1',
        company: null,
        contactName: '王经理',
        exhibitionName: '上海国际车展',
        status: 'quoted',
        reason: 'overdue',
        nextFollowUpAt: '2026-10-05T02:00:00Z',
        createdAt: '2026-10-01T00:00:00Z',
      },
      {
        projectId: 'pending-id',
        projectNo: 'PJ-2',
        company: '真实客户',
        contactName: '李四',
        exhibitionName: null,
        status: 'pending',
        reason: 'pending',
        nextFollowUpAt: null,
        createdAt: '2026-10-06T00:00:00Z',
      },
    ],
    activities: [
      {
        id: 'event-1',
        kind: 'follow-up',
        projectId: 'overdue-id',
        projectNo: 'PJ-1',
        actorName: '同事',
        byMe: false,
        fromStatus: 'following',
        toStatus: 'quoted',
        schemeCode: null,
        quotationRevision: null,
        createdAt: '2026-10-06T08:00:00Z',
      },
      {
        id: 'event-2',
        kind: 'accepted',
        projectId: 'pending-id',
        projectNo: 'PJ-2',
        actorName: null,
        byMe: false,
        fromStatus: null,
        toStatus: null,
        schemeCode: null,
        quotationRevision: null,
        createdAt: '2026-10-06T00:00:00Z',
      },
      {
        id: 'event-3',
        kind: 'quotation',
        projectId: 'overdue-id',
        projectNo: 'PJ-1',
        actorName: '张三',
        byMe: true,
        fromStatus: null,
        toStatus: null,
        schemeCode: null,
        quotationRevision: 2,
        createdAt: '2026-10-05T00:00:00Z',
      },
    ],
  },
  notifications: { unread: 4 },
};

let app: App | undefined;
let container: HTMLDivElement;
async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await nextTick();
  }
}
async function mount() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: {} },
      { path: '/projects/list', name: 'ProjectList', component: {} },
      { path: '/projects/:projectId', name: 'ProjectDetail', component: {} },
      { path: '/notifications', name: 'ProjectNotifications', component: {} },
      { path: '/scheme/list', name: 'SchemeList', component: {} },
    ],
  });
  await router.push('/');
  app = createApp(Workspace);
  app.use(router);
  app.mount(container);
  await settle();
}
function hrefs() {
  return [...container.querySelectorAll('a')].map((item) =>
    item.getAttribute('href'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = [];
  mocks.workspace.mockResolvedValue(workspaceData);
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  container.remove();
});

describe('workspace', () => {
  it('shows the signed-in admin tasks, activity and unread messages', async () => {
    mocks.permissions = ['projects.read', 'notifications.read'];
    await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('张三');
    expect(text).toContain('1 项逾期跟进、1 项今日跟进、1 项待受理');
    expect(text).toContain('需处理12');
    expect(text).toContain('未读消息4');
    expect(text).toContain('逾期跟进PJ-1王经理上海国际车展');
    expect(text).toContain('计划跟进 2026-10-05T02:00:00Z');
    expect(text).toContain('待受理PJ-2真实客户');
    expect(text).toContain('共 12 项，仅显示最紧急的 2 项');
    expect(text).toContain('同事记录跟进，状态由“跟进中”变为“已报价”');
    expect(text).toContain('客户提交了项目申请');
    expect(text).toContain('我保存了第 2 版报价');
    expect(text).not.toMatch(/Github|今日晴|访问来源/);
    expect(hrefs()).toContain('/projects/overdue-id');
    expect(hrefs()).toContain('/notifications');
  });

  it('only links authorized registered pages and hides unauthorized personal sections', async () => {
    mocks.permissions = ['schemes.read', 'bom.read'];
    mocks.workspace.mockResolvedValue({
      ...workspaceData,
      projects: null,
      notifications: null,
    });
    await mount();
    expect(hrefs()).toEqual(['/scheme/list']);
    expect(container.textContent).not.toContain('我的待办');
    expect(container.textContent).not.toContain('未读消息');
    expect(container.textContent).toContain('从快捷入口开始今天的工作');
  });

  it('does not present request failure as an empty task list and can retry', async () => {
    mocks.permissions = ['projects.read'];
    mocks.workspace
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(workspaceData);
    await mount();
    expect(container.textContent).toContain('工作台数据加载失败');
    expect(container.textContent).not.toContain('暂无逾期');
    expect(container.textContent).not.toContain('我的待办');
    [...container.querySelectorAll('button')]
      .find((item) => item.textContent?.trim() === '重新加载')
      ?.click();
    await settle();
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('工作台数据加载失败');
    expect(container.textContent).toContain('PJ-1');
  });
});
