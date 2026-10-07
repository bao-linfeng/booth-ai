import type { App } from 'vue';

import type { ProjectDetail } from '#/api/core/projects';

import { createApp, h, ref } from 'vue';

import { message } from 'ant-design-vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OperationModal from '../OperationModal.vue';
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
  followUpApi: vi.fn(),
  getAssigneesApi: vi.fn(),
  getProjectApi: vi.fn(),
  linkSchemeApi: vi.fn(),
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
  projectEventLabels: {},
  statusLabels: {
    closed: '已关闭',
    following: '跟进中',
    lost: '未成交',
    pending: '待跟进',
    quoted: '已报价',
    won: '已成交',
  },
}));

const revisionChanged = {
  response: { data: { error: { reason: 'PROJECT_REVISION_CHANGED' } } },
};
const quotation = {
  completeness: 'ready',
  revision: 2,
  validUntil: '2026-11-30',
} as ProjectDetail['quotation'];
function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    assigneeAdminId: 'admin-1',
    projectId: 'project-1',
    publicResult: null,
    quotation,
    revision: 5,
    status: 'following',
    statusTransitions: ['quoted', 'won', 'lost', 'closed'],
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  } as ProjectDetail;
}

let app: App | undefined;
let container: HTMLElement;
const reloads = vi.fn();
async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  const modalRef = ref<{
    open: (record: ProjectDetail, operation: string) => Promise<void>;
  }>();
  app = createApp({
    render: () => h(OperationModal, { onReload: reloads, ref: modalRef }),
  });
  app.mount(container);
  await flush();
  if (!modalRef.value) throw new Error('OperationModal did not mount');
  return modalRef.value;
}
async function confirm() {
  await modal.confirm();
  await flush();
}
function alertText() {
  return container.querySelector('[role="alert"]')?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  let key = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-00000000000${++key}` as const,
  );
});
afterEach(() => {
  app?.unmount();
  container.remove();
  app = undefined;
});

describe('operation modal follow-up', () => {
  it('submits only the fields of the chosen status with the platform quotation as evidence', async () => {
    const modalApi = await mount();
    await modalApi.open(project(), 'follow-up');
    expect(modal.state.title).toBe('追加跟进与状态记录');
    expect(form.state.values).toMatchObject({
      channel: '邮件',
      contactMethod: 'phone',
      evidenceType: 'platform',
      quotationRevision: 2,
    });
    form.edit({
      content: '客户确认报价',
      outcome: '切换状态后残留的隐藏字段',
      targetStatus: 'quoted',
    });
    expect(form.resolved('quotationRevision')).toMatchObject({ show: true });
    expect(form.resolved('reference')).toMatchObject({ show: false });
    expect(form.resolved('outcome')).toMatchObject({ show: false });
    api.followUpApi.mockResolvedValue({});
    await confirm();

    expect(api.followUpApi).toHaveBeenCalledTimes(1);
    const [projectId, input] = api.followUpApi.mock.calls[0] ?? [];
    expect(projectId).toBe('project-1');
    expect(input).toMatchObject({
      content: '客户确认报价',
      expectedRevision: 5,
      quoteEvidence: {
        channel: '邮件',
        quotationRevision: 2,
        type: 'platform',
      },
      requestKey: '00000000-0000-4000-8000-000000000001',
      targetStatus: 'quoted',
    });
    expect(input).not.toHaveProperty('outcome');
    expect(input).not.toHaveProperty('publicResult');
    expect(message.success).toHaveBeenCalledWith('项目记录已保存');
    expect(modal.api.close).toHaveBeenCalled();
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  it('defaults to external evidence and disables platform evidence when there is no complete quotation', async () => {
    const modalApi = await mount();
    await modalApi.open(project({ quotation: null }), 'follow-up');
    expect(form.state.values.evidenceType).toBe('external_manual');
    const options = form.options('evidenceType') as {
      disabled?: boolean;
      value: string;
    }[];
    expect(
      options.find((option) => option.value === 'platform')?.disabled,
    ).toBe(true);
    expect(form.field('quotationRevision').help).toContain(
      '还没有平台报价修订',
    );
  });

  it('offers reopening for a terminal project and requires a reason only when reopening', async () => {
    const modalApi = await mount();
    await modalApi.open(
      project({ status: 'lost', statusTransitions: ['following'] }),
      'follow-up',
    );
    const target = form.field('targetStatus');
    expect(target.label).toBe('重开项目');
    expect(form.options('targetStatus')).toEqual([
      { label: '重开为「跟进中」', value: 'following' },
    ]);
    expect(container.textContent).toContain('项目已结束，可追加说明或重开');
    expect(form.resolved('reopenReason')).toMatchObject({ show: false });
    form.edit({ targetStatus: 'following' });
    expect(form.resolved('reopenReason')).toMatchObject({
      rules: 'required',
      show: true,
    });
  });

  it('keeps the draft on a revision conflict, retries with the same key and reloads the latest revision on request', async () => {
    const modalApi = await mount();
    await modalApi.open(project(), 'follow-up');
    form.edit({ content: '已沟通', outcome: '客户签约', targetStatus: 'won' });
    api.followUpApi.mockRejectedValue(revisionChanged);
    await confirm();
    expect(alertText()).toContain('项目已被他人更新');
    expect(modal.api.close).not.toHaveBeenCalled();
    expect(form.state.values.content).toBe('已沟通');

    await confirm();
    const keys = api.followUpApi.mock.calls.map(
      ([, input]) => input.requestKey,
    );
    expect(keys[1]).toBe(keys[0]);

    api.getProjectApi.mockResolvedValue(
      project({ revision: 6, status: 'won', statusTransitions: ['following'] }),
    );
    button(container, '载入最新修订').click();
    await flush();
    expect(api.getProjectApi).toHaveBeenCalledWith('project-1');
    expect(alertText()).toBe('');
    expect(form.state.values.targetStatus).toBeUndefined();
    expect(form.state.values.content).toBe('已沟通');
    expect(form.field('targetStatus').label).toBe('重开项目');
    expect(reloads).toHaveBeenCalledTimes(1);

    api.followUpApi.mockResolvedValue({});
    await confirm();
    const last = api.followUpApi.mock.calls.at(-1)?.[1];
    expect(last.expectedRevision).toBe(6);
    expect(last.requestKey).not.toBe(keys[0]);
    expect(last).not.toHaveProperty('targetStatus');
  });

  it('issues a new request key once the draft changes and offers no reload for non-conflict failures', async () => {
    const modalApi = await mount();
    await modalApi.open(project(), 'follow-up');
    form.edit({ content: '第一次' });
    api.followUpApi.mockRejectedValue(new Error('network'));
    await confirm();
    expect(alertText()).toContain('保存未确认');
    expect(container.textContent).not.toContain('载入最新修订');
    form.edit({ content: '修改后' });
    await confirm();
    const [first, second] = api.followUpApi.mock.calls.map(
      ([, input]) => input.requestKey,
    );
    expect(second).not.toBe(first);
  });
});

describe('operation modal assignment and scheme', () => {
  it('reassigns with the selected admin and reason against the current revision', async () => {
    api.getAssigneesApi.mockResolvedValue([
      { id: 'admin-1', name: '原负责人' },
      { id: 'admin-2', name: '新负责人' },
    ]);
    const modalApi = await mount();
    await modalApi.open(project(), 'assignment');
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
    expect(api.followUpApi).not.toHaveBeenCalled();
  });

  it('links the confirmed scheme with the customer confirmation note', async () => {
    const modalApi = await mount();
    await modalApi.open(project(), 'scheme');
    form.edit({ confirmationNote: '客户邮件确认', schemeCode: 'SC-6030' });
    api.linkSchemeApi.mockResolvedValue({});
    await confirm();
    expect(api.linkSchemeApi).toHaveBeenCalledWith('project-1', {
      confirmationNote: '客户邮件确认',
      expectedRevision: 5,
      requestKey: '00000000-0000-4000-8000-000000000001',
      schemeCode: 'SC-6030',
    });
  });
});
