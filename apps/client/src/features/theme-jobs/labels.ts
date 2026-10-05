import type { ThemeJob } from '@/services/api/theme-jobs'

export const themeJobStatusLabels: Record<ThemeJob['status'], string> = {
  pending: '等待处理', queued: '排队中', running: '生成中', settling: '结算中',
  succeeded: '生成完成', partially_succeeded: '部分完成', failed: '生成失败',
}

export function phaseText(job: ThemeJob | null) {
  if (!job) return '加载中...'
  if (job.status === 'queued') return '排队中'
  if (job.status === 'running') return 'AI 正在生成'
  if (job.status === 'settling') return '正在结算'
  return job.phase || '请稍候'
}

export function failureReasonText(reason?: string | null) {
  if (!reason) return '未知错误'
  const labels: Record<string, string> = {
    INSUFFICIENT_CREDITS: '积分不足',
    PROVIDER_ERROR: 'AI 服务商暂不可用',
    INTERNAL_ERROR: '系统内部错误',
  }
  return labels[reason] || reason
}

export function blockedReasonText(reasons: string[]) {
  if (reasons.includes('MODEL_UNAVAILABLE')) return '平台生成服务暂不可用，请稍后重试。'
  if (reasons.includes('MASK_UNAVAILABLE')) return '该视角暂无可用编辑区域，请选择其他原图。'
  if (reasons.includes('TEMPLATE_UNAVAILABLE')) return '当前风格暂不可用，请调整视觉偏好。'
  return '当前条件暂不可生成，请调整偏好或稍后重试。'
}
