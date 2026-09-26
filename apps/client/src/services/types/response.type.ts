/** 本地 Fastify API 响应结构 */
export interface IResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export interface IPageData<T = unknown> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

export type IPageResponse<T = unknown> = IResponse<IPageData<T>>

/** 灵通外部 API 通用响应结构（code 为字符串） */
export interface LtResponse<T = unknown> {
  code: string
  msg: string
  data: T
  success: boolean
}
