import type { App } from 'vue';

import type { Project } from '#/api/core/projects';

import { createApp, h, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PublicResultModal from '../PublicResultModal.vue';
import { flush } from './fake-vben';

const form = await vi.hoisted(async () => {
  const { createFakeForm } = await import('./fake-vben');
  return createFakeForm();
});
const modal = await vi.hoisted(async () => {
  const { createFakeModal } = await import('./fake-vben');
  return createFakeModal();
});
const api = vi.hoisted(() => ({ updatePublicResultApi: vi.fn() }));

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

type Target = Pick<Project, 'projectId' | 'publicResult' | 'revision'>;

let app: App | undefined;
let container: HTMLElement;
const reloads = vi.fn();
async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  const modalRef = ref<{ open: (record: Target) => Promise<void> }>();
  app = createApp({
    render: () => h(PublicResultModal, { onReload: reloads, ref: modalRef }),
  });
  app.mount(container);
  await flush();
  if (!modalRef.value) throw new Error('PublicResultModal did not mount');
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
});
afterEach(() => {
  app?.unmount();
  container.remove();
  app = undefined;
});

describe('public result modal', () => {
  it('warns that the content is customer visible and submits against the current revision', async () => {
    const modalApi = await mount();
    await modalApi.open({
      projectId: 'project-1',
      publicResult: '报价已发送',
      revision: 4,
    });
    expect(modal.state.title).toBe('更新客户进度');
    expect(container.textContent).toContain('提交后客户可见');
    expect(form.state.values.publicResult).toBe('报价已发送');
    form.edit({ publicResult: '已确认方案，安排搭建' });
    api.updatePublicResultApi.mockRejectedValueOnce(new Error('network'));
    await confirm();
    expect(
      container.querySelector('[role="alert"]:last-of-type')?.textContent,
    ).toContain('保存未确认');
    expect(reloads).not.toHaveBeenCalled();
    api.updatePublicResultApi.mockResolvedValue({});
    await confirm();
    expect(api.updatePublicResultApi).toHaveBeenCalledTimes(2);
    expect(api.updatePublicResultApi).toHaveBeenLastCalledWith('project-1', {
      expectedRevision: 4,
      publicResult: '已确认方案，安排搭建',
      requestKey: '00000000-0000-4000-8000-000000000001',
    });
    expect(reloads).toHaveBeenCalledTimes(1);
  });
});
