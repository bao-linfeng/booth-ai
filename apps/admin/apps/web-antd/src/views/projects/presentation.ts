import type {
  Asset,
  MatchingSummary,
  ProjectEvent,
  ProjectStatus,
} from '#/api/core/projects';

import { formatDateTime } from '@vben/utils';

import { projectEventLabels, statusLabels } from '#/api/core/projects';
import { REASON_MESSAGES } from '#/api/reason-messages';

export interface SummaryItem {
  label: string;
  value: string;
}

export const terminalStatuses: ProjectStatus[] = ['won', 'lost', 'closed'];

export const contactMethodLabels: Record<string, string> = {
  phone: '电话',
  email: '邮件',
  customer_service: '客服',
  meeting: '会议',
  other: '其他',
};

/** 进入终态时 outcome 字段在不同目标状态下的含义 */
export const outcomeLabels: Partial<Record<ProjectStatus, string>> = {
  won: '成交结果',
  lost: '未成交原因',
  closed: '关闭原因',
};

export const matchTypeLabels: Record<MatchingSummary['matchType'], string> = {
  direct: '直接匹配',
  reference: '参考方案（存在差异）',
  random: '随机推荐',
  unmatched: '不满足确认条件',
};

export const entryPointLabels: Record<string, string> = {
  scheme_detail: '方案详情',
  bill_of_materials: '物料清单',
  theme_result: 'AI 换主题结果',
  matching_results: '方案匹配结果',
  su: 'SU 设计',
};

export const scopeLabels: Record<string, string> = {
  materials: '材料采购',
  graphics: '品牌画面',
  transport: '运输',
  installation: '搭建',
  other: '其他',
};

export const materialStatusLabels: Record<string, string> = {
  available: '已就绪',
  pending: '待生成',
  missing: '缺失',
};

const imageExtension = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

/** 历史快照可能缺少 mimeType，此时按文件扩展名判断。 */
export function isImageAsset(asset: Asset): boolean {
  return asset.mimeType
    ? asset.mimeType.startsWith('image/')
    : imageExtension.test(asset.filename);
}

const optionFields: [string, string][] = [
  ['productSystemId', '产品体系'],
  ['styleIds', '风格'],
  ['industryIds', '行业'],
  ['budgetTierId', '预算档位'],
  ['zoneIds', '功能区'],
  ['requiredZoneIds', '必须包含的功能区'],
  ['excludedZoneIds', '排除的功能区'],
  ['featureIds', '功能特征'],
  ['requiredFeatureIds', '必须包含的特征'],
  ['excludedFeatureIds', '排除的特征'],
];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string');
}

const metres = (mm: number) => `${mm / 1000} m`;

/** 把确认条件转成销售可读的条目，未设置的条件不展示。 */
export function requirementSummary(
  requirement: Record<string, unknown> | undefined,
  optionLabels: Record<string, string>,
): SummaryItem[] {
  if (!requirement) return [];
  const items: SummaryItem[] = [];
  const length = positive(requirement.lengthMm);
  const width = positive(requirement.widthMm);
  if (length && width)
    items.push({
      label: '展位尺寸',
      value: `${length / 1000} × ${width / 1000} m`,
    });
  else if (length) items.push({ label: '展位长度', value: metres(length) });
  else if (width) items.push({ label: '展位宽度', value: metres(width) });
  const boothSpace = text(requirement.boothSpaceId);
  if (!length && !width && boothSpace)
    items.push({
      label: '展位规格',
      value: optionLabels[boothSpace] ?? '已删除的选项',
    });
  const height = positive(requirement.maxHeightMm);
  if (height) items.push({ label: '限高', value: metres(height) });
  const area = positive(requirement.areaM2);
  if (area) items.push({ label: '面积', value: `${area} ㎡` });
  const openings = positive(requirement.openingCount);
  if (openings) items.push({ label: '开口', value: `${openings} 面开口` });
  for (const [field, label] of optionFields) {
    const ids = strings(requirement[field]);
    if (ids.length > 0)
      items.push({
        label,
        value: ids.map((id) => optionLabels[id] ?? '已删除的选项').join('、'),
      });
  }
  const keywords = strings(requirement.keywords);
  if (keywords.length > 0)
    items.push({ label: '关键词', value: keywords.join('、') });
  return items;
}

function quoteEvidence(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const evidence = value as Record<string, unknown>;
  const channel = text(evidence.channel) ?? '';
  const sent = `${formatDateTime(String(evidence.sentAt))} 通过${contactMethodLabels[channel] ?? channel}发送`;
  return evidence.type === 'platform'
    ? `平台报价 r${String(evidence.quotationRevision)}，${sent}`
    : `外部报价「${text(evidence.reference) ?? '未填写'}」，${sent}`;
}

function compact(items: [string, string | undefined][]): SummaryItem[] {
  return items
    .filter((item): item is [string, string] => !!item[1])
    .map(([label, value]) => ({ label, value }));
}

/** 把事件 payload 转成时间线标题与明细，未知事件回退为原始数据。 */
export function eventSummary(event: ProjectEvent): {
  lines: SummaryItem[];
  title: string;
} {
  const payload = event.payload;
  switch (event.kind) {
    case 'accepted': {
      return {
        title: `受理项目，分配给 ${event.assigneeName ?? '承接人'}`,
        lines: [],
      };
    }
    case 'assignment': {
      return {
        title: `改派承接人：${event.fromAssigneeName ?? '原承接人'} → ${event.assigneeName ?? '新承接人'}`,
        lines: compact([['原因', text(payload.reason)]]),
      };
    }
    case 'claimed': {
      return { title: '客户登录后认领项目', lines: [] };
    }
    case 'follow-up': {
      const from = payload.fromStatus as ProjectStatus | undefined;
      const to = payload.status as ProjectStatus | undefined;
      const method = String(payload.contactMethod ?? '');
      const changed =
        from && to && from !== to
          ? `，状态 ${statusLabels[from]} → ${statusLabels[to]}`
          : '';
      return {
        title: `${contactMethodLabels[method] ?? method}跟进${changed}`,
        lines: compact([
          [
            '联系时间',
            text(payload.contactedAt) &&
              formatDateTime(String(payload.contactedAt)),
          ],
          ['跟进内容', text(payload.content)],
          [(to && outcomeLabels[to]) ?? '结果说明', text(payload.outcome)],
          ['重开原因', text(payload.reopenReason)],
          ['报价依据', quoteEvidence(payload.quoteEvidence)],
          ['客户可见结果', text(payload.publicResult)],
          [
            '下次跟进',
            text(payload.nextFollowUpAt) &&
              formatDateTime(String(payload.nextFollowUpAt)),
          ],
        ]),
      };
    }
    case 'legacy_import': {
      return {
        title: '历史人工需求迁入',
        lines: compact([
          ['迁入说明', text(payload.reason)],
          ['历史跟进', text(payload.content)],
        ]),
      };
    }
    case 'quotation': {
      return {
        title: `保存报价修订 r${String(payload.quotationRevision)}`,
        lines: compact([['修改原因', text(payload.changeReason)]]),
      };
    }
    case 'scheme': {
      return {
        title: `确认关联方案 ${String(payload.schemeCode)}`,
        lines: compact([['客户确认依据', text(payload.confirmationNote)]]),
      };
    }
    default: {
      return {
        title: projectEventLabels[event.kind] ?? event.kind,
        lines: [{ label: '记录', value: JSON.stringify(payload) }],
      };
    }
  }
}

export function failureReason(error: unknown): string | undefined {
  return (
    error as null | { response?: { data?: { error?: { reason?: string } } } }
  )?.response?.data?.error?.reason;
}

/** 项目操作失败时在弹窗内保留的说明；草稿始终保留，便于修正后重试。 */
export function operationFailureMessage(error: unknown): string {
  const reason = failureReason(error);
  if (reason === 'PROJECT_REVISION_CHANGED')
    return '项目已被他人更新。请载入最新修订，核对状态与报价后再提交；已填写内容会保留。';
  if (reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason];
  if (reason === 'INVALID_INPUT')
    return '提交内容不完整或时间不合理：联系时间不能晚于当前时间，下次跟进需晚于联系时间。';
  if (reason === 'RESOURCE_NOT_FOUND')
    return '所填报价修订不存在，请核对修订号。';
  if (reason === 'ACCESS_DENIED') return '没有执行该操作的权限。';
  return '保存未确认，已填写内容已保留。请检查网络后重试，或刷新项目确认是否已保存。';
}
