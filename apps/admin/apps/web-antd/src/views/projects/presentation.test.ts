import type { ProjectEvent } from '#/api/core/projects';

import { describe, expect, it, vi } from 'vitest';

import { buildFollowUp } from './follow-up';
import {
  eventSummary,
  failureDetails,
  followUpUrgency,
  operationFailureMessage,
  requirementSummary,
} from './presentation';

vi.mock('#/api/core/projects', () => ({
  poolReasonLabels: { disabled: '默认承接人已停用' },
  projectEventLabels: { custom: '自定义事件' },
  statusLabels: {
    closed: '已关闭',
    following: '跟进中',
    lost: '未成交',
    pending: '待跟进',
    quoted: '已报价',
    won: '已成交',
  },
}));
vi.mock('@vben/utils', () => ({ formatDateTime: (value: string) => value }));

const event = (
  kind: string,
  payload: Record<string, unknown>,
): ProjectEvent => ({
  id: kind,
  kind,
  actorName: '销售',
  assigneeName: '新负责人',
  fromAssigneeName: '原负责人',
  payload,
  createdAt: '2026-10-01T00:00:00Z',
});
const change = { requestKey: 'key', expectedRevision: 3 };
const base = {
  contactMethod: 'email',
  contactedAt: '2026-10-01T08:00:00Z',
  content: '已沟通',
};

describe('requirementSummary', () => {
  it('formats set conditions with dictionary labels and skips empty ones', () => {
    expect(
      requirementSummary(
        {
          boothSpaceId: 'space',
          lengthMm: 6000,
          widthMm: 3000,
          maxHeightMm: null,
          openingCount: 2,
          styleIds: ['modern', 'gone'],
          industryIds: [],
          budgetTierId: null,
          keywords: ['洽谈区'],
        },
        { modern: '现代简约' },
      ),
    ).toEqual([
      { label: '展位尺寸', value: '6 × 3 m' },
      { label: '开口', value: '2 面开口' },
      { label: '风格', value: '现代简约、已删除的选项' },
      { label: '关键词', value: '洽谈区' },
    ]);
    expect(requirementSummary(undefined, {})).toEqual([]);
  });
});

describe('eventSummary', () => {
  it('describes status changes, outcome and quote evidence of follow-ups', () => {
    expect(
      eventSummary(
        event('follow-up', {
          contactMethod: 'meeting',
          contactedAt: '2026-10-01T08:00:00Z',
          content: '客户确认',
          fromStatus: 'quoted',
          status: 'won',
          outcome: '接受报价',
          publicResult: '',
        }),
      ),
    ).toEqual({
      title: '会议跟进，状态 已报价 → 已成交',
      lines: [
        { label: '联系时间', value: '2026-10-01T08:00:00Z' },
        { label: '跟进内容', value: '客户确认' },
        { label: '成交结果', value: '接受报价' },
      ],
    });
    expect(
      eventSummary(
        event('follow-up', {
          contactMethod: 'email',
          content: '已发报价',
          fromStatus: 'following',
          status: 'quoted',
          quoteEvidence: {
            type: 'platform',
            quotationRevision: 2,
            sentAt: '2026-10-01T09:00:00Z',
            channel: 'email',
          },
        }),
      ).lines,
    ).toContainEqual({
      label: '报价依据',
      value: '平台报价 r2，2026-10-01T09:00:00Z 通过邮件发送',
    });
  });

  it('reports quotation email delivery and failures with the recipient', () => {
    expect(
      eventSummary(
        event('quotation-email', {
          status: 'delivered',
          quotationRevision: 3,
          recipient: 'buyer@example.com',
          errorCode: null,
        }),
      ),
    ).toEqual({
      title: '报价邮件 r3 已发出',
      lines: [{ label: '收件邮箱', value: 'buyer@example.com' }],
    });
    expect(
      eventSummary(
        event('quotation-email', {
          status: 'failed',
          quotationRevision: 3,
          recipient: 'buyer@example.com',
          errorCode: 'SMTP_EENVELOPE',
        }),
      ).lines,
    ).toContainEqual({
      label: '失败原因',
      value: 'SMTP_EENVELOPE，请核对客户邮箱后重新发送',
    });
  });

  it('marks acceptance into the assignment pool with its reason', () => {
    expect(
      eventSummary(
        event('accepted', { assigneeAdminId: null, poolReason: 'disabled' }),
      ).title,
    ).toBe('受理项目，进入待分配（原因：默认承接人已停用）');
    expect(
      eventSummary(event('accepted', { assigneeAdminId: 'a' })).title,
    ).toBe('受理项目，分配给 新负责人');
  });

  it('distinguishes linking a scheme from relinking it', () => {
    expect(
      eventSummary(
        event('scheme', { schemeCode: 'SC-1', fromSchemeCode: null }),
      ).title,
    ).toBe('确认关联方案 SC-1');
    expect(
      eventSummary(
        event('scheme', { schemeCode: 'SC-2', fromSchemeCode: 'SC-1' }),
      ).title,
    ).toBe('重新关联方案 SC-1 → SC-2');
  });

  it('names assignees and falls back to raw payload for unknown kinds', () => {
    expect(eventSummary(event('assignment', { reason: '区域调整' }))).toEqual({
      title: '改派承接人：原负责人 → 新负责人',
      lines: [{ label: '原因', value: '区域调整' }],
    });
    expect(
      eventSummary(event('assignment', { fromAdminId: null, reason: '分配' }))
        .title,
    ).toBe('分配承接人：→ 新负责人');
    expect(
      eventSummary(
        event('assignment', { fromAdminId: null, selfClaimed: true }),
      ),
    ).toEqual({ title: '新负责人 领取项目', lines: [] });
    expect(eventSummary(event('custom', { a: 1 }))).toEqual({
      title: '自定义事件',
      lines: [{ label: '记录', value: '{"a":1}' }],
    });
  });
});

describe('public result and follow-up urgency', () => {
  it('describes public result updates, including withdrawals', () => {
    expect(
      eventSummary(event('public-result', { publicResult: '报价已发送' })),
    ).toEqual({
      title: '更新客户说明',
      lines: [{ label: '客户可见内容', value: '报价已发送' }],
    });
    expect(
      eventSummary(event('public-result', { publicResult: null })).lines,
    ).toEqual([{ label: '客户可见内容', value: '（已撤下）' }]);
  });

  it('flags overdue and due-today follow-ups of open projects in Shanghai time', () => {
    const now = new Date('2026-10-21T02:00:00Z'); // 上海 10:00
    const at = (nextFollowUpAt: null | string, status = 'following') =>
      followUpUrgency({ nextFollowUpAt, status: status as 'following' }, now);
    expect(at('2026-10-21T01:00:00Z')).toBe('overdue');
    expect(at('2026-10-21T15:00:00Z')).toBe('today'); // 上海 23:00
    expect(at('2026-10-21T16:30:00Z')).toBeUndefined(); // 上海次日 00:30
    expect(at('2026-10-20T01:00:00Z', 'won')).toBeUndefined();
    expect(at(null)).toBeUndefined();
  });
});

describe('buildFollowUp', () => {
  it('only submits fields relevant to the target status', () => {
    const input = buildFollowUp(
      { status: 'following' },
      {
        ...base,
        targetStatus: 'quoted',
        outcome: '残留',
        reopenReason: '残留',
        evidenceType: 'external_manual',
        quotationRevision: 1,
        reference: 'EXT-1',
        sentAt: '2026-10-01T09:00:00Z',
        channel: 'email',
      },
      change,
    );
    expect(input).toEqual({
      ...change,
      contactMethod: 'email',
      contactedAt: '2026-10-01T08:00:00.000Z',
      content: '已沟通',
      targetStatus: 'quoted',
      quoteEvidence: {
        type: 'external_manual',
        reference: 'EXT-1',
        sentAt: '2026-10-01T09:00:00.000Z',
        channel: 'email',
      },
    });
  });

  it('requires reopening reason only from terminal states and never sends the public result', () => {
    const reopen = buildFollowUp(
      { status: 'won' },
      {
        ...base,
        targetStatus: 'following',
        reopenReason: '追加服务',
        publicResult: '残留的旧字段',
      },
      change,
    );
    expect(reopen.reopenReason).toBe('追加服务');
    expect(reopen).not.toHaveProperty('publicResult');
    const plain = buildFollowUp(
      { status: 'quoted' },
      { ...base, targetStatus: 'following', reopenReason: '残留' },
      change,
    );
    expect(plain).not.toHaveProperty('reopenReason');
    expect(
      buildFollowUp(
        { status: 'quoted' },
        { ...base, targetStatus: 'lost', outcome: '预算不足' },
        change,
      ).outcome,
    ).toBe('预算不足');
  });
});

describe('operationFailureMessage', () => {
  const failure = (reason: string) => ({
    response: { data: { error: { reason } } },
  });
  it('distinguishes revision conflicts, missing evidence and invalid transitions', () => {
    expect(
      operationFailureMessage(failure('PROJECT_REVISION_CHANGED')),
    ).toContain('载入最新修订');
    expect(
      operationFailureMessage(failure('QUOTE_EVIDENCE_REQUIRED')),
    ).toContain('发送依据');
    expect(
      operationFailureMessage(failure('INVALID_STATUS_TRANSITION')),
    ).toContain('目标状态');
    expect(operationFailureMessage(new Error('network'))).toContain('已保留');
    expect(operationFailureMessage(failure('ASSIGNEE_REQUIRED'))).toContain(
      '尚未分配承接人',
    );
  });

  it('reads details attached to a business reason', () => {
    expect(
      failureDetails({
        response: { data: { error: { details: { assigneeName: '张三' } } } },
      }),
    ).toEqual({ assigneeName: '张三' });
    expect(failureDetails(new Error('network'))).toEqual({});
  });
});
