import type { App } from 'vue';

import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  summary: vi.fn(),
  statistics: vi.fn(),
}));
vi.mock('#/api/core/dashboard', () => ({
  getDashboardSummaryApi: mocks.summary,
}));
vi.mock('#/api/core/scheme-searches', () => ({
  getSchemeSearchStatisticsApi: mocks.statistics,
}));
vi.mock('#/api/core/projects', () => ({
  statusLabels: { won: '已成交', pending: '待跟进' },
}));
vi.mock('@vben/access', () => ({
  useAccess: () => ({
    hasAccessByCodes: (codes: string[]) =>
      codes.some((code) => mocks.permissions.includes(code)),
  }),
}));
vi.mock('@vben/utils', () => ({ formatDateTime: (value: string) => value }));
vi.mock('@vben/common-ui', () => ({
  Page: defineComponent(
    (_, { slots }) =>
      () =>
        h('main', slots.default?.()),
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
      setup: (props) => () => h('div', `${props.message} ${props.description}`),
    }),
    Button: defineComponent(
      (_, { slots, attrs }) =>
        () =>
          h('button', attrs, slots.default?.()),
    ),
    Card: defineComponent(
      (_, { slots }) =>
        () =>
          h('section', [slots.extra?.(), slots.default?.()]),
    ),
    Empty: defineComponent({
      props: ['description'],
      setup: (props) => () => h('div', props.description),
    }),
    Skeleton: defineComponent(() => () => h('div', '加载中')),
    Table: defineComponent({
      props: ['dataSource', 'columns'],
      setup:
        (props, { slots }) =>
        () =>
          h(
            'div',
            (props.dataSource as unknown[]).flatMap((record) =>
              (props.columns as unknown[]).map((column) =>
                slots.bodyCell?.({ record, column }),
              ),
            ),
          ),
    }),
    Tag: Passthrough,
  };
});

import BusinessOverview from './BusinessOverview.vue';

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
      {
        path: '/ai-selection/analytics',
        name: 'AiSelectionAnalytics',
        component: {},
      },
    ],
  });
  await router.push('/');
  app = createApp(BusinessOverview, { title: '工作台' });
  app.use(router);
  app.mount(container);
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = [];
  mocks.summary.mockResolvedValue({
    generatedAt: '2026-10-07T01:00:00Z',
    projects: null,
    schemes: null,
    generation: null,
    notifications: null,
  });
  mocks.statistics.mockResolvedValue({
    overview: {
      searches: 12,
      uniqueVisitors: 9,
      matchedSearches: 8,
      noMatchSearches: 4,
    },
  });
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  container.remove();
});

describe('business homepage', () => {
  it('shows only authorized registered entries and never requests unauthorized selection statistics', async () => {
    mocks.permissions = ['projects.read', 'schemes.read'];
    await mount();
    expect(
      [...container.querySelectorAll('a')].map((item) =>
        item.getAttribute('href'),
      ),
    ).toEqual(['/projects/list']);
    expect(mocks.statistics).not.toHaveBeenCalled();
    expect(container.textContent).toContain('当前账号暂无业务数据权限');
    expect(container.textContent).not.toMatch(/Github|今日晴|用户量|访问量/);
  });
  it('shows persisted zero counts, recent inquiry status and reused selection statistics', async () => {
    mocks.permissions = ['projects.read', 'search-analytics.read'];
    mocks.summary.mockResolvedValue({
      generatedAt: '2026-10-07T01:00:00Z',
      projects: {
        pending: 0,
        todayFollowUps: 2,
        overdueFollowUps: 1,
        recentInquiries: [
          {
            projectId: 'real-id',
            projectNo: 'PJ-42',
            company: '真实客户',
            status: 'won',
            createdAt: '2026-10-07',
          },
        ],
      },
      schemes: null,
      generation: null,
      notifications: null,
    });
    await mount();
    expect(container.textContent).toContain('待跟进项目0');
    expect(container.textContent).toContain('真实客户');
    expect(container.textContent).toContain('已成交');
    expect(
      container.querySelector('a[href="/projects/real-id"]'),
    ).not.toBeNull();
    expect(mocks.statistics).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('累计检索12');
  });
  it('does not present request failure as zero and can retry', async () => {
    mocks.summary
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ generatedAt: 'now', projects: null });
    await mount();
    expect(container.textContent).toContain('业务数据加载失败');
    expect(container.textContent).not.toContain('待跟进项目');
    container.querySelector('button')?.click();
    await settle();
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('业务数据加载失败');
  });
  it('keeps business data visible when selection statistics fail and allows a separate retry', async () => {
    mocks.permissions = ['search-analytics.read'];
    mocks.statistics.mockRejectedValueOnce(new Error('network'));
    await mount();
    expect(container.textContent).toContain('智选统计加载失败');
    expect(container.textContent).toContain('当前账号暂无业务数据权限');
    [...container.querySelectorAll('button')]
      .find((item) => item.textContent?.trim() === '刷新智选统计')
      ?.click();
    await settle();
    expect(mocks.statistics).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('累计检索12');
    expect(mocks.summary).toHaveBeenCalledOnce();
  });
});
