import { describe, expect, it, vi } from 'vitest';

import { listQuery } from './options';

vi.mock('#/api/core/projects', () => ({
  listProjectsApi: vi.fn(),
  statusLabels: {},
}));

describe('project list query', () => {
  it('applies "only mine" unless an assignment filter is chosen', () => {
    expect(listQuery({ mine: true, status: 'pending' })).toEqual({
      mine: true,
      status: 'pending',
    });
    expect(listQuery({ mine: false, followUp: 'overdue' })).toEqual({
      followUp: 'overdue',
    });
    // 选了分配情况时忽略「只看我负责的」，否则待分配项目永远查不到
    expect(listQuery({ mine: true, assignment: 'unassigned' })).toEqual({
      assignment: 'unassigned',
    });
  });
});
