import { describe, expect, it, vi } from 'vitest';

import {
  notificationKindLabel,
  notificationTitle,
} from './project-notifications';

vi.mock('#/api/request', () => ({ requestClient: {} }));

describe('notificationKindLabel', () => {
  it('labels pooled acceptance and personal assignment notifications', () => {
    expect(notificationKindLabel({ kind: 'accepted', audience: 'all' })).toBe(
      '新项目受理',
    );
    expect(
      notificationKindLabel({ kind: 'accepted', audience: 'assigners' }),
    ).toBe('新项目待分配');
    expect(
      notificationKindLabel({ kind: 'assignment', audience: 'recipient' }),
    ).toBe('项目分配给你');
    expect(notificationKindLabel({ kind: 'custom', audience: 'all' })).toBe(
      'custom',
    );
    expect(
      notificationTitle({
        kind: 'accepted',
        audience: 'assigners',
        projectNo: 'PJ-1',
      } as Parameters<typeof notificationTitle>[0]),
    ).toBe('新项目待分配 · PJ-1');
  });
});
