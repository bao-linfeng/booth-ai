import type { AdminMessage } from '#/api/core/customer-service';

import { describe, expect, it } from 'vitest';

import { eventText } from '#/api/core/customer-service';

import {
  fetchAllAfter,
  maxSeq,
  mergeMessages,
  minSeq,
  readTarget,
  translationHint,
  translationOf,
  waitingText,
} from '../timeline';

function message(
  seq: number,
  overrides: Partial<AdminMessage> = {},
): AdminMessage {
  return {
    id: `m${seq}`,
    seq,
    conversationId: 'c1',
    conversationNo: 'CS-00000001',
    senderType: 'customer',
    senderName: null,
    senderAdminId: null,
    kind: 'text',
    visibility: 'public',
    body: `body ${seq}`,
    locale: 'en',
    context: null,
    eventCode: null,
    eventParams: null,
    translations: [],
    clientMessageId: null,
    createdAt: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}

describe('customer service timeline', () => {
  it('keeps paging newer messages until hasMore is false', async () => {
    const all = [1, 2, 3, 4, 5].map((seq) => message(seq));
    const cursors: number[] = [];
    const items = await fetchAllAfter(async (after) => {
      cursors.push(after);
      const rest = all.filter((item) => item.seq > after);
      return { hasMore: rest.length > 2, items: rest.slice(0, 2) };
    }, 0);
    expect(cursors).toEqual([0, 2, 4]);
    expect(items.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('merges by id, keeps the latest copy and sorts by seq', () => {
    const merged = mergeMessages(
      [message(3), message(1)],
      [
        message(2),
        message(3, {
          translations: [{ body: '你好', locale: 'zh', status: 'done' }],
        }),
      ],
    );
    expect(merged.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(merged[2]?.translations[0]?.body).toBe('你好');
    expect(maxSeq(merged)).toBe(3);
    expect(minSeq(merged)).toBe(1);
    expect(minSeq([])).toBeUndefined();
  });

  it('reads translations for text messages only and labels pending or failed ones', () => {
    const pending = {
      body: null,
      locale: 'zh' as const,
      status: 'pending' as const,
    };
    expect(translationOf(message(1, { translations: [pending] }))).toEqual(
      pending,
    );
    expect(
      translationOf(message(1, { kind: 'note', translations: [pending] })),
    ).toBeNull();
    expect(
      translationOf(message(1, { senderType: 'system', kind: 'event' })),
    ).toBeNull();
    expect(translationHint(pending)).toBe('翻译中');
    expect(translationHint({ ...pending, status: 'failed' })).toBe('翻译失败');
    expect(translationHint(null)).toBe('');
  });

  it('formats waiting time and reports reads only when new customer messages arrived', () => {
    const now = Date.parse('2026-10-08T01:05:30Z');
    expect(waitingText('2026-10-08T01:05:00Z', now)).toBe('30 秒');
    expect(waitingText('2026-10-08T00:55:30Z', now)).toBe('10 分钟');
    expect(waitingText('2026-10-07T23:00:30Z', now)).toBe('2 小时 5 分钟');
    expect(waitingText(null, now)).toBe('');
    const messages = [message(1), message(2, { senderType: 'agent' })];
    expect(readTarget(messages, 0)).toBe(2);
    expect(readTarget(messages, 1)).toBeNull();
  });

  it('renders system events in Chinese and shows transfer reasons to staff', () => {
    expect(
      eventText({ eventCode: 'claimed', eventParams: { agentName: null } }),
    ).toBe('客服 已接入');
    expect(
      eventText({
        eventCode: 'transferred',
        eventParams: { agentName: 'Lily', reason: 'VIP', toQueue: false },
      }),
    ).toBe('改派给 Lily（原因：VIP）');
    expect(
      eventText({ eventCode: 'transferred', eventParams: { toQueue: true } }),
    ).toBe('退回队列');
    expect(eventText({ eventCode: 'agent_unavailable', eventParams: {} })).toBe(
      '坐席已不可用，会话重新排队',
    );
  });
});
