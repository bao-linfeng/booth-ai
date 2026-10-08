import type { App } from 'vue';

import type { ProjectDetail, ProjectEvent } from '#/api/core/projects';

import { createApp, h } from 'vue';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import ProjectWorkspace from '../detail.vue';
import { button, flush } from './fake-vben';

const api = vi.hoisted(() => ({ getProjectApi: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { projectId: 'project-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('#/api/core/projects', () => ({
  ...api,
  assetDownloadApi: vi.fn(),
  assigneeStatusLabels: { active: '有效' },
  projectEventLabels: {},
  statusLabels: { following: '跟进中' },
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
  const { defineComponent, h: render } = await import('vue');
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
vi.mock('../OperationModal.vue', () => ({ default: { render: () => null } }));
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
