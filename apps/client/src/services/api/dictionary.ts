import { lingtongPublicFetch } from '@/lib/api-client'

// 灵通企业公共字典（国家、城市），无需登录
export interface DictItem { dictKey: string; dictValue: string; dictName: string }

async function queryDict(path: string, query: Record<string, string>): Promise<DictItem[]> {
  const response = await lingtongPublicFetch<{ data: DictItem[] }>(path, { query })
  return Array.isArray(response.data) ? response.data : []
}

export function getCountries() {
  return queryDict('/api/systemDict/queryCountries', { keyword: '' })
}

export function getCities(countryCode: string) {
  return queryDict('/api/systemDict/queryCities', { countryCode, cityName: '' })
}
