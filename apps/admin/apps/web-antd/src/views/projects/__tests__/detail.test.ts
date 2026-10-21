import type { App } from 'vue';

import type { ProjectDetail, ProjectEvent } from '#/api/core/projects';

import { createApp, h } from 'vue';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import ProjectWorkspace from '../detail.vue';
import { button, flush } from './fake-vben';

const api = vi.hoisted(() => ({
  assetDownloadApi: vi.fn(),
  assetImagesApi: vi.fn(),
  getProjectApi: vi.fn(),
}));
const claim = vi.hoisted(() => ({ claimProject: vi.fn() }));
const modals = vi.hoisted(() => ({
  assign: vi.fn(),
  operation: vi.fn(),
  publicResult: vi.fn(),
}));
const access = vi.hoisted(() => ({ codes: new Set<string>() }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { projectId: 'project-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('#/api/core/projects', () => ({
  ...api,
  assigneeStatusLabels: { active: '有效' },
  poolReasonLabels: { unconfigured: '未配置默认承接人' },
  projectEventLabels: {},
  statusLabels: { following: '跟进中' },
}));
vi.mock('@vben/access', () => ({
  useAccess: () => ({
    hasAccessByCodes: (codes: string[]) =>
      codes.every((code) => access.codes.has(code)),
  }),
}));
vi.mock('@vben/utils', () => ({
  formatDateTime: (value: string) => value,
  openWindow: vi.fn(),
}));
vi.mock('@vben/common-ui', async () => {
  const { defineComponent, h: render } = await import('vue');
  return {
    Page: defineComponent(
      (_, { slots }) =>
        () =>
          render('main', slots.default?.()),
    ),
  };
});
vi.mock('ant-design-vue', async () => {
  const vue = await import('vue');
  const { defineComponent, h: render } = vue;
  const { fakeAntd } = await import('./fake-vben');
  const passthrough = defineComponent(
    (_, { slots }) =>
      () =>
        render('div', slots.default?.()),
  );
  return {
    ...(await fakeAntd()),
    Card: defineComponent(
      (_, { slots }) =>
        () =>
          render('div', [slots.extra?.(), slots.default?.()]),
    ),
    Descriptions: passthrough,
    DescriptionsItem: passthrough,
    Image: defineComponent({
      props: { alt: String, preview: Object, src: String },
      setup: (props) => () =>
        render('img', {
          alt: props.alt,
          'data-preview': (props.preview as undefined | { src?: string })?.src,
          src: props.src,
        }),
    }),
    ImagePreviewGroup: passthrough,
    TabPane: passthrough,
    // 只渲染当前标签页，标签按钮切换 activeKey
    Tabs: defineComponent({
      props: { activeKey: { type: String, default: undefined } },
      emits: ['update:activeKey'],
      setup:
        (props, { emit, slots }) =>
        () => {
          const { Fragment } = vue;
          const panes = (slots.default?.() ?? []).flatMap((node) =>
            node.type === Fragment
              ? (node.children as (typeof node)[])
              : [node],
          );
          return render('section', [
            render(
              'div',
              { role: 'tablist' },
              panes.map((pane) =>
                render(
                  'button',
                  {
                    type: 'button',
                    onClick: () => emit('update:activeKey', pane.key),
                  },
                  String(pane.props?.tab ?? ''),
                ),
              ),
            ),
            ...panes.filter((pane) => pane.key === props.activeKey),
          ]);
        },
    }),
    Pagination: defineComponent(() => () => render('nav')),
    Timeline: defineComponent(
      (_, { slots }) =>
        () =>
          render('ol', slots.default?.()),
    ),
    TimelineItem: defineComponent(
      (_, { slots }) =>
        () =>
          render('li', slots.default?.()),
    ),
  };
});
// 子弹窗只暴露 open，记录详情页传入的参数
async function exposedModal(open: (...args: unknown[]) => unknown) {
  const { defineComponent } = await import('vue');
  return {
    default: defineComponent((_, { expose }) => {
      expose({ open });
      return () => null;
    }),
  };
}
vi.mock('../OperationModal.vue', () => exposedModal(modals.operation));
vi.mock('../AssignModal.vue', () => exposedModal(modals.assign));
vi.mock('../PublicResultModal.vue', () => exposedModal(modals.publicResult));
vi.mock('../claim', () => claim);
vi.mock('../QuotationEditor.vue', () => ({ default: { render: () => null } }));
vi.mock('../CustomerServiceCard.vue', () => ({
  default: { render: () => null },
}));

function project(events: ProjectEvent[]): ProjectDetail {
  return {
    assigneeAdminId: 'admin-1',
    assigneeName: '负责人',
    assigneeStatus: 'active',
    createdAt: '2026-10-01T00:00:00Z',
    customerUserId: null,
    events,
    materials: {},
    nextFollowUpAt: null,
    projectId: 'project-1',
    projectNo: 'PJ-001',
    publicResult: null,
    quotation: null,
    request: { contact: { name: '客户' } },
    requestNo: 'REQ-001',
    requirementOptionLabels: {},
    revision: 1,
    schemeCode: null,
    schemeSnapshot: null,
    sourceType: 'manual_request',
    status: 'following',
    statusTransitions: [],
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

let app: App | undefined;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.assetImagesApi.mockResolvedValue([]);
  access.codes = new Set(['projects.asset-download']);
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  container.remove();
});

it('shows every timeline event in API order without pagination and refreshes the complete timeline', async () => {
  const events: ProjectEvent[] = Array.from({ length: 25 }, (_, index) => ({
    actorName: null,
    assigneeName: null,
    createdAt: new Date(Date.UTC(2026, 9, 25 - index)).toISOString(),
    fromAssigneeName: null,
    id: `event-${25 - index}`,
    kind: 'quotation',
    payload: { quotationRevision: 25 - index },
  }));
  api.getProjectApi.mockResolvedValue(project(events));
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();

  const titles = () =>
    [...container.querySelectorAll('ol > li .font-medium')].map(
      (item) => item.textContent,
    );
  expect(api.getProjectApi).toHaveBeenCalledWith('project-1');
  expect(titles()).toEqual(
    events.map((event) => `保存报价修订 r${event.payload.quotationRevision}`),
  );
  expect(container.querySelector('nav')).toBeNull();

  api.getProjectApi.mockResolvedValue(
    project([
      {
        actorName: null,
        assigneeName: null,
        createdAt: '2026-10-26T00:00:00Z',
        fromAssigneeName: null,
        id: 'event-26',
        kind: 'quotation',
        payload: { quotationRevision: 26 },
      },
      ...events,
    ]),
  );
  button(container, '刷新项目').click();
  await flush();
  expect(titles()).toHaveLength(26);
  expect(titles()[0]).toBe('保存报价修订 r26');
  expect(titles().at(-1)).toBe('保存报价修订 r1');
});

async function openTab(name: string) {
  const tab = [...container.querySelectorAll('[role="tablist"] button')].find(
    (item) => item.textContent === name,
  );
  if (!tab) throw new Error(`Tab not found: ${name}`);
  (tab as HTMLButtonElement).click();
  await flush();
}

function asset(versionId: string, name: string, mimeType?: string) {
  return { filename: `${name}.bin`, mimeType, name, type: 'x', versionId };
}

it('labels request codes in Chinese and previews image assets while other files stay downloadable', async () => {
  const detail = project([]);
  detail.request = {
    ...detail.request,
    entryPoint: 'theme_result',
    scopeCodes: ['graphics', 'installation'],
    scopeNotes: '全权负责',
  };
  detail.materials = {
    drawings: {
      assets: [
        asset('drawing-1', '正面方向底图', 'image/png'),
        asset('drawing-2', '施工图', 'application/pdf'),
        asset('drawing-3', '侧面方向底图', 'image/jpeg'),
      ],
      status: 'available',
    },
    artworks: { assets: [], status: 'pending' },
  };
  api.getProjectApi.mockResolvedValue(detail);
  // 服务端只返回能签发的图片；没有地址的图片（drawing-3）退回下载按钮
  api.assetImagesApi.mockResolvedValue([
    {
      versionId: 'drawing-1',
      thumbnailUrl: 'https://s3.test/drawing-1/thumb',
      previewUrl: 'https://s3.test/drawing-1/preview',
    },
  ]);
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();
  // 默认打开时间线，概览的图片地址在首次进入概览时才请求
  expect(api.assetImagesApi).not.toHaveBeenCalled();
  await openTab('概览');

  const text = (container.textContent ?? '').replaceAll(/\s+/g, ' ');
  expect(text).toContain('人工需求 / AI 换主题结果');
  expect(text).toContain('品牌画面、搭建');
  expect(text).toContain('范围说明：全权负责');
  expect(text).toContain('清单缺失 / 图纸已就绪 / 素材待生成');
  expect(text).not.toMatch(/theme_result|graphics|available/);
  expect(api.assetImagesApi).toHaveBeenCalledTimes(1);
  expect(api.assetImagesApi).toHaveBeenCalledWith('project-1');
  expect(api.assetDownloadApi).not.toHaveBeenCalled();
  const images = [
    ...container.querySelectorAll<HTMLElement>('[data-asset-group="图纸"] img'),
  ];
  expect(
    images.map((image) => [image.getAttribute('src'), image.dataset.preview]),
  ).toEqual([
    ['https://s3.test/drawing-1/thumb', 'https://s3.test/drawing-1/preview'],
  ]);
  expect(button(container, '下载：侧面方向底图')).toBeTruthy();
  expect(button(container, '下载：施工图')).toBeTruthy();

  await openTab('时间线');
  await openTab('概览');
  expect(api.assetImagesApi).toHaveBeenCalledTimes(1);
  button(container, '刷新项目').click();
  await flush();
  expect(api.assetImagesApi).toHaveBeenCalledTimes(2);
});

it('does not request image urls without asset download permission', async () => {
  access.codes = new Set();
  const detail = project([]);
  detail.materials = {
    drawings: {
      assets: [asset('drawing-1', '底图', 'image/png')],
      status: 'available',
    },
  };
  api.getProjectApi.mockResolvedValue(detail);
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();
  await openTab('概览');

  expect(api.assetImagesApi).not.toHaveBeenCalled();
  expect(container.querySelector('img')).toBeNull();
});

it('shows pooled projects as unassigned, offers claiming and blocks follow-up until assigned', async () => {
  const pooled = {
    ...project([
      {
        actorName: null,
        assigneeName: null,
        createdAt: '2026-10-01T00:00:00Z',
        fromAssigneeName: null,
        id: 'accepted',
        kind: 'accepted',
        payload: { assigneeAdminId: null, poolReason: 'unconfigured' },
      },
    ]),
    assigneeAdminId: null,
    assigneeName: null,
    assigneeStatus: 'unassigned' as const,
    status: 'pending' as const,
  };
  api.getProjectApi.mockResolvedValue(pooled);
  claim.claimProject.mockResolvedValue(true);
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();

  const text = container.textContent ?? '';
  expect(text).toContain('项目待分配');
  expect(text).toContain('受理项目，进入待分配（原因：未配置默认承接人）');
  expect(button(container, '追加跟进').disabled).toBe(true);
  expect(button(container, '确认关联方案').disabled).toBe(true);
  expect(button(container, '分配').disabled).toBe(false);
  expect(button(container, '分配给我').disabled).toBe(false);

  api.getProjectApi.mockResolvedValue({
    ...pooled,
    assigneeAdminId: 'admin-1',
    assigneeName: '我',
    assigneeStatus: 'active',
  });
  button(container, '分配给我').click();
  await flush();
  expect(claim.claimProject).toHaveBeenCalledWith('project-1');
  expect(api.getProjectApi).toHaveBeenCalledTimes(2);
  expect(button(container, '追加跟进').disabled).toBe(false);
  expect(button(container, '改派')).toBeTruthy();
  expect(() => button(container, '分配给我')).toThrow('Button not found');
});

it('offers quick status actions for open projects and direct reassignment for terminal ones', async () => {
  const open = {
    ...project([]),
    statusTransitions: ['quoted', 'won', 'lost', 'closed'] as const,
  } as unknown as ProjectDetail;
  api.getProjectApi.mockResolvedValue(open);
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();

  expect(() => button(container, '开始跟进')).toThrow('Button not found');
  button(container, '标记成交').click();
  expect(modals.operation).toHaveBeenLastCalledWith(
    expect.objectContaining({ projectId: 'project-1' }),
    'follow-up',
    { targetStatus: 'won' },
  );
  expect(button(container, '标记未成交')).toBeTruthy();
  button(container, '关闭项目').click();
  expect(modals.operation).toHaveBeenLastCalledWith(
    expect.anything(),
    'follow-up',
    { targetStatus: 'closed' },
  );
  await openTab('概览');
  button(container, '更新客户进度').click();
  expect(modals.publicResult).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'project-1' }),
  );
  app.unmount();

  api.getProjectApi.mockResolvedValue({
    ...project([]),
    status: 'won',
    statusTransitions: ['following'],
  });
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();
  expect(button(container, '改派').disabled).toBe(false);
  expect(() => button(container, '标记成交')).toThrow('Button not found');
  expect(button(container, '追加跟进').disabled).toBe(false);
  button(container, '改派').click();
  expect(modals.assign).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'won' }),
  );
});

it('summarises the project in a header card and splits details into tabs', async () => {
  api.getProjectApi.mockResolvedValue({
    ...project([]),
    nextFollowUpAt: '2020-01-01T00:00:00Z',
    request: {
      company: '演示公司',
      contact: { name: '客户' },
      exhibition: {
        city: '上海',
        countryCode: 'CN',
        endDate: '2026-11-22',
        name: '上海车展',
        startDate: '2026-11-20',
      },
      materialBudget: { amount: '30000', currency: 'CNY' },
    },
  });
  app = createApp({ render: () => h(ProjectWorkspace) });
  app.directive('access', {});
  app.mount(container);
  await flush();
  const summary = container.querySelector('[data-test="summary"]');
  const text = (summary?.textContent ?? '').replaceAll(/\s+/g, ' ');
  expect(text).toContain('负责人');
  expect(text).toContain('演示公司');
  expect(text).toContain('上海车展');
  expect(text).toContain('CNY 30000');
  expect(summary?.querySelector('.text-red-500')?.textContent?.trim()).toBe(
    '2020-01-01T00:00:00Z',
  );
  expect(
    [...container.querySelectorAll('[role="tablist"] button')].map(
      (tab) => tab.textContent,
    ),
  ).toEqual(['概览', '报价', '时间线', '客服会话']);
  expect(container.querySelector('ol')).not.toBeNull();
  expect(container.textContent).not.toContain('清单缺失');
  await openTab('概览');
  expect(container.textContent).toContain('清单缺失 / 图纸缺失 / 素材缺失');
  expect(container.querySelector('ol')).toBeNull();
});
