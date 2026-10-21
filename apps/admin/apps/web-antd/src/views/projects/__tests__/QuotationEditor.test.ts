import type { App } from 'vue';

import type { ProjectDetail, Quotation } from '#/api/core/projects';

import { createApp, h, shallowRef } from 'vue';

import { message } from 'ant-design-vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QuotationEditor from '../QuotationEditor.vue';
import { button, flush } from './fake-vben';

const form = await vi.hoisted(async () => {
  const { createFakeForm } = await import('./fake-vben');
  return createFakeForm();
});
const access = vi.hoisted(() => ({ codes: new Set<string>() }));
const api = vi.hoisted(() => ({
  quotationApi: vi.fn(),
  quotationDownloadApi: vi.fn(),
  quotationRevisionsApi: vi.fn(),
  saveQuotationApi: vi.fn(),
}));

vi.mock('#/adapter/form', () => ({ useVbenForm: form.useVbenForm }));
vi.mock('#/api/core/projects', () => ({
  ...api,
  poolReasonLabels: {},
  projectEventLabels: {},
  statusLabels: {},
}));
vi.mock('ant-design-vue', async () => {
  const { fakeAntd } = await import('./fake-vben');
  return fakeAntd();
});
vi.mock('@vben/access', () => ({
  useAccess: () => ({
    hasAccessByCodes: (codes: string[]) =>
      codes.every((code) => access.codes.has(code)),
  }),
}));
vi.mock('@vben/utils', () => ({
  cloneDeep: <T>(value: T): T => structuredClone(value),
  downloadFileFromBlob: vi.fn(),
  formatDateTime: (value: string) => value,
}));

const savedQuotation: Quotation = {
  changeReason: '首次报价',
  completeness: 'ready',
  createdAt: '2026-10-01T00:00:00Z',
  currency: 'CNY',
  currencyScale: 2,
  exclusions: '',
  inclusions: '',
  items: [
    {
      clientLineId: 'line-1',
      kind: 'installation',
      lineAmount: '1200.00',
      name: '搭建',
      pricingUnit: '项',
      quantity: '1',
      unitPrice: '1200',
    },
    {
      clientLineId: 'line-2',
      kind: 'other',
      lineAmount: null,
      name: '运输待补',
      pricingUnit: '项',
      quantity: '1',
      unitPrice: '',
    },
  ],
  priceBasis: 'excluded',
  quotationNo: 'QT-001',
  revision: 2,
  roundingMode: 'HALF_UP',
  terms: '',
  totalAmount: null,
  validationIssues: [],
  validityTimeZone: 'Asia/Shanghai',
  validUntil: '2026-11-30',
};
function savedLine(index: number) {
  const line = savedQuotation.items[index];
  if (!line) throw new Error(`Missing saved line ${index}`);
  return line;
}
function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    assigneeAdminId: 'admin-1',
    materials: {
      bom: {
        items: [
          {
            erpCode: 'ERP-01',
            id: 'bom-1',
            ordinal: 1,
            pricingUnit: '根',
            productModel: 'FS62',
            productName: '铝框立柱',
            quantity: '6',
            specificationMm: '3000',
          },
        ],
      },
    },
    projectId: 'project-1',
    projectNo: 'PJ-001',
    quotation: null,
    request: { materialBudget: { amount: '30000', currency: 'USD' } },
    revision: 5,
    status: 'following',
    ...overrides,
  } as ProjectDetail;
}

let app: App | undefined;
let container: HTMLElement;
const reloads = vi.fn();
async function mount(initial: ProjectDetail) {
  const current = shallowRef(initial);
  container = document.createElement('div');
  document.body.append(container);
  app = createApp({
    render: () =>
      h(QuotationEditor, { onReload: reloads, project: current.value }),
  });
  app.directive('access', {});
  app.mount(container);
  await flush();
  return current;
}
async function save() {
  button(container, '保存新报价修订').click();
  await flush();
}
const saved = () => api.saveQuotationApi.mock.calls.map(([, input]) => input);

function chooseHistory(revision: number) {
  const select = container.querySelector<HTMLSelectElement>(
    '[data-test="history"]',
  );
  if (!select) throw new Error('Missing history select');
  select.value = String(revision);
  select.dispatchEvent(new Event('change'));
}
const summary = (revision: number) => ({
  completeness: 'ready',
  createdAt: '2026-10-01T00:00:00Z',
  createdByName: '销售',
  currency: 'CNY',
  revision,
  totalAmount: '1200.00',
  validUntil: '2026-11-30',
  validityTimeZone: 'Asia/Shanghai',
});

beforeEach(() => {
  vi.clearAllMocks();
  api.quotationRevisionsApi.mockResolvedValue([summary(2), summary(1)]);
  access.codes = new Set(['projects.quotation']);
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

describe('quotation editor', () => {
  it('starts a first revision from the BOM snapshot and saves it against the project revision', async () => {
    await mount(project());
    expect(form.state.values).toMatchObject({
      currency: 'USD',
      priceBasis: 'excluded',
      validityTimeZone: 'Asia/Shanghai',
    });
    button(container, '从项目清单快照复制材料').click();
    await flush();
    expect(container.querySelector('table')?.dataset.rows).toBe('1');
    form.edit({ changeReason: '首次报价' });
    api.saveQuotationApi.mockResolvedValue({
      projectRevision: 6,
      quotation: { ...savedQuotation, revision: 1 },
    });
    await save();

    expect(api.saveQuotationApi).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        changeReason: '首次报价',
        expectedQuotationRevision: 0,
        expectedRevision: 5,
        requestKey: expect.stringMatching(/^0{8}-/),
      }),
    );
    expect(saved()[0].items).toEqual([
      {
        bomItemId: 'bom-1',
        clientLineId: expect.any(String),
        erpCode: 'ERP-01',
        kind: 'material',
        model: 'FS62',
        name: '铝框立柱',
        pricingUnit: '根',
        quantity: '6',
        specificationMm: '3000',
        unitPrice: null,
      },
    ]);
    expect(message.success).toHaveBeenCalled();
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  it('strips server line amounts, sends blank prices as null and chains the next save onto the saved revision', async () => {
    await mount(project({ quotation: savedQuotation, revision: 7 }));
    form.edit({ changeReason: '调整运输' });
    api.saveQuotationApi.mockResolvedValue({
      projectRevision: 8,
      quotation: { ...savedQuotation, revision: 3 },
    });
    await save();
    const first = saved()[0];
    expect(first).toMatchObject({
      expectedQuotationRevision: 2,
      expectedRevision: 7,
    });
    expect(
      first.items.map((item: { unitPrice: unknown }) => item.unitPrice),
    ).toEqual(['1200', null]);
    expect(first.items.some((item: object) => 'lineAmount' in item)).toBe(
      false,
    );

    form.edit({ changeReason: '再次调整' });
    await save();
    expect(saved()[1]).toMatchObject({
      expectedQuotationRevision: 3,
      expectedRevision: 8,
    });
  });

  it('keeps the draft and its request key when a save is not confirmed, and issues a new key once the draft changes', async () => {
    await mount(project({ quotation: savedQuotation }));
    form.edit({ changeReason: '调价' });
    api.saveQuotationApi.mockRejectedValue(new Error('network'));
    await save();
    expect(message.error).toHaveBeenCalledWith(
      expect.stringContaining('草稿已保留'),
    );
    await save();
    expect(saved()[1].requestKey).toBe(saved()[0].requestKey);
    expect(form.state.values.changeReason).toBe('调价');

    form.edit({ changeReason: '调价并补运输' });
    await save();
    expect(saved()[2].requestKey).not.toBe(saved()[0].requestKey);
    expect(reloads).not.toHaveBeenCalled();
  });

  it('does not let a parent reload overwrite an unsaved draft', async () => {
    const current = await mount(project({ quotation: savedQuotation }));
    form.edit({ changeReason: '未保存的修改' });
    current.value = project({
      quotation: { ...savedQuotation, changeReason: '他人保存', revision: 3 },
      revision: 9,
    });
    await flush();
    expect(form.state.values.changeReason).toBe('未保存的修改');

    button(container, '放弃草稿').click();
    await flush();
    expect(form.state.values.changeReason).toBe('他人保存');
    expect(() => button(container, '放弃草稿')).toThrow('Button not found');
  });

  it('blocks switching to history while dirty, and history is read-only', async () => {
    await mount(project({ quotation: savedQuotation }));
    expect(api.quotationRevisionsApi).toHaveBeenCalledWith('project-1');
    const options = [
      ...container.querySelectorAll('[data-test="history"] option'),
    ].map((option) => option.textContent);
    expect(options).toContain(
      'r1 · 完整 · CNY 1200.00 · 销售 2026-10-01T00:00:00Z',
    );
    form.edit({ changeReason: '未保存' });
    chooseHistory(1);
    await flush();
    expect(message.info).toHaveBeenCalledWith(
      expect.stringContaining('放弃草稿'),
    );
    expect(api.quotationApi).not.toHaveBeenCalled();

    button(container, '放弃草稿').click();
    await flush();
    api.quotationApi.mockResolvedValue({
      quotation: { ...savedQuotation, revision: 1 },
    });
    chooseHistory(1);
    await flush();
    expect(api.quotationApi).toHaveBeenCalledWith('project-1', 1);
    expect(container.textContent).toContain('历史报价');
    expect(form.state.commonConfig.disabled).toBe(true);
    expect(button(container, '保存新报价修订').disabled).toBe(true);
    await form.api.validateAndSubmitForm();
    expect(api.saveQuotationApi).not.toHaveBeenCalled();

    button(container, '回到当前').click();
    await flush();
    expect(container.textContent).toContain('当前编辑');
    expect(form.state.commonConfig.disabled).toBe(false);
  });

  it('keeps the draft on a revision conflict and saves onto the latest revisions after loading them', async () => {
    const current = await mount(project({ quotation: savedQuotation }));
    form.edit({ changeReason: '我的修改' });
    api.saveQuotationApi.mockRejectedValueOnce({
      response: { data: { error: { reason: 'QUOTATION_REVISION_CHANGED' } } },
    });
    await save();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '报价已有更新的修订',
    );
    expect(message.error).not.toHaveBeenCalled();
    button(container, '载入最新').click();
    expect(reloads).toHaveBeenCalledTimes(1);
    current.value = project({
      quotation: { ...savedQuotation, changeReason: '他人保存', revision: 3 },
      revision: 9,
    });
    await flush();
    expect(form.state.values.changeReason).toBe('我的修改');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    api.saveQuotationApi.mockResolvedValue({
      projectRevision: 10,
      quotation: { ...savedQuotation, revision: 4 },
      status: 'following',
    });
    await save();
    expect(saved().at(-1)).toMatchObject({
      changeReason: '我的修改',
      expectedQuotationRevision: 3,
      expectedRevision: 9,
    });
  });

  it('computes line amounts live, translates pending issues and blocks malformed numbers', async () => {
    await mount(
      project({
        quotation: {
          ...savedQuotation,
          validationIssues: ['PRICE_MISSING:line-2', 'INCLUSIONS_REQUIRED'],
        },
      }),
    );
    expect(
      container.querySelector('[data-test="issues"]')?.textContent,
    ).toContain('第 2 行「运输待补」缺单价、未填写包含范围');
    expect(
      container.querySelector('[data-test="live-total"]')?.textContent,
    ).toBe('待补完整价格');
    const rows = container.querySelectorAll('[data-test="row"]');
    expect(rows[1]?.className).toContain('quotation-row-missing');
    expect(
      [...container.querySelectorAll('[data-test="line-amount"]')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['1200.00', '缺价']);
    app?.unmount();
    container.remove();

    const priced = {
      ...savedQuotation,
      items: [
        { ...savedLine(0), quantity: '3', unitPrice: '0.335' },
        { ...savedLine(1), unitPrice: '0.335' },
      ],
    };
    await mount(project({ quotation: priced }));
    expect(
      container.querySelector('[data-test="live-total"]')?.textContent,
    ).toBe('CNY 1.35');
    app?.unmount();
    container.remove();

    await mount(
      project({
        quotation: {
          ...savedQuotation,
          items: [{ ...savedLine(0), quantity: '1.0000001' }],
        },
      }),
    );
    form.edit({ changeReason: '格式错误' });
    await save();
    expect(api.saveQuotationApi).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith(
      expect.stringContaining('第 1 行数量或单价格式不正确'),
    );
  });

  it('offers common time zones first in a searchable list', async () => {
    await mount(project());
    const options = form.options('validityTimeZone') as { value: string }[];
    expect(options[0]?.value).toBe('Asia/Shanghai');
    expect(options.filter((option) => option.value === 'UTC')).toHaveLength(1);
    expect(form.field('validityTimeZone').componentProps?.showSearch).toBe(
      true,
    );
  });

  it('refuses to save for terminal projects or without the quotation permission', async () => {
    await mount(project({ quotation: savedQuotation, status: 'won' }));
    expect(container.textContent).toContain('终态项目需先通过跟进记录明确重开');
    expect(form.state.commonConfig.disabled).toBe(true);
    button(container, '从项目清单快照复制材料').click();
    await form.api.validateAndSubmitForm();
    app?.unmount();
    container.remove();

    access.codes = new Set();
    await mount(project({ quotation: savedQuotation }));
    expect(form.state.commonConfig.disabled).toBe(true);
    await form.api.validateAndSubmitForm();
    expect(api.saveQuotationApi).not.toHaveBeenCalled();
  });

  it('saves and queues the quotation email in one request when allowed to follow up', async () => {
    const contact = { contact: { email: 'buyer@example.com', name: '客户' } };
    const priced = { ...savedQuotation, items: [savedLine(0)] };
    const withEmail = (quotation: Quotation) =>
      project({
        quotation,
        request: { ...project().request, ...contact },
      } as Partial<ProjectDetail>);
    await mount(withEmail(priced));
    expect(() => button(container, '保存并发送报价')).toThrow(
      'Button not found',
    );
    app?.unmount();
    container.remove();

    access.codes = new Set(['projects.follow-up', 'projects.quotation']);
    // 客户没有邮箱时不能发送
    await mount(
      project({
        quotation: priced,
        request: { ...project().request, contact: { name: '客户' } },
      } as Partial<ProjectDetail>),
    );
    expect(button(container, '保存并发送报价').disabled).toBe(true);
    app?.unmount();
    container.remove();

    // 有未填价的行时前端直接提示，不打开确认框
    await mount(withEmail(savedQuotation));
    button(container, '保存并发送报价').click();
    await flush();
    expect(message.error).toHaveBeenCalledWith(
      '第 2 行未填单价，补全价格后才能发送',
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    app?.unmount();
    container.remove();

    await mount(withEmail(priced));
    form.edit({ changeReason: '发送前调价' });
    button(container, '保存并发送报价').click();
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('send dialog did not open');
    expect(
      dialog.querySelector('[data-test="send-recipient"]')?.textContent,
    ).toBe('buyer@example.com');
    expect(dialog.textContent).toContain('项目转为「已报价」');
    api.saveQuotationApi.mockResolvedValue({
      projectRevision: 6,
      quotation: { ...priced, revision: 3 },
      status: 'quoted',
    });
    button(dialog, '保存并发送').click();
    await flush();
    expect(saved()[0]).toMatchObject({
      changeReason: '发送前调价',
      sendEmail: true,
    });
    expect(message.success).toHaveBeenCalledWith(
      expect.stringContaining('报价邮件已进入发送队列'),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // 发送带上已报价，详情页据此提示更新客户说明
    expect(reloads).toHaveBeenLastCalledWith('quoted');

    // 普通保存不携带发送标记
    form.edit({ changeReason: '再次调整' });
    api.saveQuotationApi.mockResolvedValue({
      projectRevision: 7,
      quotation: { ...priced, revision: 4 },
      status: 'quoted',
    });
    await save();
    expect(saved()[1]).not.toHaveProperty('sendEmail');
    expect(reloads).toHaveBeenLastCalledWith(undefined);
  });

  it('refuses to save while the project is waiting in the assignment pool', async () => {
    await mount(project({ assigneeAdminId: null, status: 'pending' }));
    expect(container.textContent).toContain('待分配项目需先分配承接人');
    expect(form.state.commonConfig.disabled).toBe(true);
    expect(button(container, '保存新报价修订').disabled).toBe(true);
    await form.api.validateAndSubmitForm();
    expect(api.saveQuotationApi).not.toHaveBeenCalled();
  });
});
