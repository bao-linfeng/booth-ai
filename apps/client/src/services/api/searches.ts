import { apiFetch } from '@/lib/api-client'
import type { Requirement, Specifications } from '@/features/selection/types'
import type { ThemeJob } from './theme-jobs'
import type { Direction } from './artwork-jobs'

export interface SearchTheme {
  jobId: string
  status: ThemeJob['status']
  createdAt: string
  previewUrl: string | null
}

export interface SearchArtwork {
  jobId: string
  status: ThemeJob['status']
  createdAt: string
  deliveryStatus: 'pending' | 'incomplete' | 'ready'
  views: Array<{ direction: Direction; previewUrl: string }>
}

export interface SearchHistoryItem {
  code: string
  matchType: 'direct' | 'reference' | 'random'
  specifications: Specifications
  thumbnail: string
  theme: SearchTheme | null
  artwork: SearchArtwork | null
}

export interface SearchRecord {
  id: string
  status: string
  mode: string
  inputText: string
  finalRequirement: Requirement
  counts: { direct: number; reference: number; random: number; total: number }
  items: SearchHistoryItem[]
  createdAt: string
}

export interface SearchPage {
  items: SearchRecord[]
  total: number
  page: number
  pageSize: number
}

export async function getMySearches(query: { page: number; pageSize: number }): Promise<SearchPage> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  return (await apiFetch<{ code: number; data: SearchPage }>(`/api/v1/client/me/searches?${params}`)).data
}
