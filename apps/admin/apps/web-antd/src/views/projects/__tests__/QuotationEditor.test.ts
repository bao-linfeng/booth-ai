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
  saveQuotationApi: vi.fn(),
}));

vi.mock('#/adapter/form', () => ({ useVbenForm: form.useVbenForm }));
vi.mock('#/api/core/projects', () => api);
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
function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
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

beforeEach(() => {
  vi.clearAllMocks();
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

    button(container, '放弃草稿 / 回到当前').click();
    await flush();
    expect(form.state.values.changeReason).toBe('他人保存');
  });

  it('blocks switching to history while dirty, and history is read-only', async () => {
    await mount(project({ quotation: savedQuotation }));
    const history = container.querySelector<HTMLInputElement>(
      '[data-test="history"]',
    );
    if (!history) throw new Error('Missing history input');
    history.value = '1';
    history.dispatchEvent(new Event('input'));
    form.edit({ changeReason: '未保存' });
    button(container, '读取历史').click();
    await flush();
    expect(message.info).toHaveBeenCalled();
    expect(api.quotationApi).not.toHaveBeenCalled();

    button(container, '放弃草稿 / 回到当前').click();
    await flush();
    api.quotationApi.mockResolvedValue({
      quotation: { ...savedQuotation, revision: 1 },
    });
    button(container, '读取历史').click();
    await flush();
    expect(api.quotationApi).toHaveBeenCalledWith('project-1', 1);
    expect(container.textContent).toContain('历史报价');
    expect(form.state.commonConfig.disabled).toBe(true);
    expect(button(container, '保存新报价修订').disabled).toBe(true);
    await form.api.validateAndSubmitForm();
    expect(api.saveQuotationApi).not.toHaveBeenCalled();
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
});
