import type { App } from 'vue';

import type { Project } from '#/api/core/projects';

import { createApp, h, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AssignModal from '../AssignModal.vue';
import { button, flush } from './fake-vben';

const form = await vi.hoisted(async () => {
  const { createFakeForm } = await import('./fake-vben');
  return createFakeForm();
});
const modal = await vi.hoisted(async () => {
  const { createFakeModal } = await import('./fake-vben');
  return createFakeModal();
});
const api = vi.hoisted(() => ({
  assignProjectApi: vi.fn(),
  getAssigneesApi: vi.fn(),
  getProjectApi: vi.fn(),
}));

vi.mock('#/adapter/form', () => ({ useVbenForm: form.useVbenForm }));
vi.mock('@vben/common-ui', () => ({ useVbenModal: modal.useVbenModal }));
vi.mock('@vben/utils', () => ({ formatDateTime: (value: string) => value }));
vi.mock('ant-design-vue', async () => {
  const { fakeAntd } = await import('./fake-vben');
  return fakeAntd();
});
vi.mock('#/api/core/projects', () => ({
  ...api,
  poolReasonLabels: {},
  projectEventLabels: {},
  statusLabels: {},
}));

type Target = Pick<Project, 'assigneeAdminId' | 'projectId' | 'revision'>;

let app: App | undefined;
let container: HTMLElement;
const reloads = vi.fn();
async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  const modalRef = ref<{ open: (record: Target) => Promise<void> }>();
  app = createApp({
    render: () => h(AssignModal, { onReload: reloads, ref: modalRef }),
  });
  app.mount(container);
  await flush();
  if (!modalRef.value) throw new Error('AssignModal did not mount');
  return modalRef.value;
}
async function confirm() {
  await modal.confirm();
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  let key = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-00000000000${++key}` as const,
  );
  api.getAssigneesApi.mockResolvedValue([
    { id: 'admin-1', name: '原负责人' },
    { id: 'admin-2', name: '新负责人' },
  ]);
});
afterEach(() => {
  app?.unmount();
  container.remove();
  app = undefined;
});

describe('assign modal', () => {
  it('reassigns with the selected admin and reason against the current revision', async () => {
    const modalApi = await mount();
    await modalApi.open({
      assigneeAdminId: 'admin-1',
      projectId: 'project-1',
      revision: 5,
    });
    expect(modal.state.title).toBe('改派承接人');
    expect(form.state.values.assigneeAdminId).toBe('admin-1');
    expect(form.options('assigneeAdminId')).toEqual([
      { label: '原负责人', value: 'admin-1' },
      { label: '新负责人', value: 'admin-2' },
    ]);
    form.edit({ assigneeAdminId: 'admin-2', reason: '区域调整' });
    api.assignProjectApi.mockResolvedValue({});
    await confirm();
    expect(api.assignProjectApi).toHaveBeenCalledWith('project-1', {
      assigneeAdminId: 'admin-2',
      expectedRevision: 5,
      reason: '区域调整',
      requestKey: '00000000-0000-4000-8000-000000000001',
    });
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  it('assigns a pooled project and recovers from a stale list revision', async () => {
    const modalApi = await mount();
    await modalApi.open({
      assigneeAdminId: null,
      projectId: 'project-1',
      revision: 1,
    });
    expect(modal.state.title).toBe('分配承接人');
    expect(form.state.values.assigneeAdminId).toBeUndefined();
    expect(container.textContent).toContain('待分配池');
    form.edit({ assigneeAdminId: 'admin-2', reason: '按区域分配' });
    api.assignProjectApi.mockRejectedValueOnce({
      response: { data: { error: { reason: 'PROJECT_REVISION_CHANGED' } } },
    });
    await confirm();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '项目已被他人更新',
    );
    expect(reloads).not.toHaveBeenCalled();
    api.getProjectApi.mockResolvedValue({
      assigneeAdminId: null,
      projectId: 'project-1',
      revision: 2,
    });
    button(container, '载入最新修订').click();
    await flush();
    expect(reloads).toHaveBeenCalledTimes(1);
    api.assignProjectApi.mockResolvedValue({});
    await confirm();
    expect(api.assignProjectApi).toHaveBeenLastCalledWith(
      'project-1',
      expect.objectContaining({
        assigneeAdminId: 'admin-2',
        expectedRevision: 2,
        requestKey: '00000000-0000-4000-8000-000000000002',
      }),
    );
  });
});
