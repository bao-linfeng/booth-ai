import type {
  Change,
  ContactMethod,
  FollowUp,
  ProjectDetail,
  ProjectStatus,
} from '#/api/core/projects';

import { outcomeLabels, terminalStatuses } from './presentation';

const iso = (value: unknown) => new Date(String(value)).toISOString();

/** 按目标状态只提交相关字段，切换状态后残留的隐藏字段不会进入请求。 */
export function buildFollowUp(
  record: Pick<ProjectDetail, 'status'>,
  values: Record<string, unknown>,
  change: Change,
): FollowUp {
  const target = (values.targetStatus || undefined) as
    | ProjectStatus
    | undefined;
  const input: FollowUp = {
    ...change,
    contactMethod: values.contactMethod as ContactMethod,
    contactedAt: iso(values.contactedAt),
    content: String(values.content),
  };
  if (values.nextFollowUpAt) input.nextFollowUpAt = iso(values.nextFollowUpAt);
  if (target) input.targetStatus = target;
  if (target && outcomeLabels[target]) input.outcome = String(values.outcome);
  if (target === 'following' && terminalStatuses.includes(record.status))
    input.reopenReason = String(values.reopenReason);
  if (target === 'quoted') {
    const sentAt = iso(values.sentAt);
    const channel = values.channel as ContactMethod;
    input.quoteEvidence =
      values.evidenceType === 'platform'
        ? {
            type: 'platform',
            quotationRevision: Number(values.quotationRevision),
            sentAt,
            channel,
          }
        : {
            type: 'external_manual',
            reference: String(values.reference),
            sentAt,
            channel,
          };
  }
  return input;
}
