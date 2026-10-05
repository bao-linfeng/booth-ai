import type { Direction } from '@/services/api/artwork-jobs'

export const directionLabels: Record<Direction, string> = { front: '正面', back: '背面', left: '左侧', right: '右侧' }

export const reasonLabels: Record<string, string> = {
  ARTWORK_RESOLUTION_TOO_LOW: '输出像素低于高清标准',
  ARTWORK_FORMAT_INVALID: '输出格式无法验收',
  ARTWORK_IMAGE_INVALID: '图片无法读取或解码',
  ARTWORK_SIZE_INVALID: '图片大小不合格',
  MODEL_UNAVAILABLE: '所选模型已不可用',
  PROVIDER_OUTCOME_UNKNOWN: '服务商未返回可确认的结果',
  PROCESSING_FAILED: '处理失败',
}
