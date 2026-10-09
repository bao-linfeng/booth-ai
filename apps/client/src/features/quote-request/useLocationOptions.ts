import { onMounted, ref, watch } from 'vue'
import { getCities, getCountries, type DictItem } from '@/services/api/dictionary'
import type { RequestForm } from './form'

/**
 * 国家、城市下拉选项。读取失败与“没有数据”分开标记，失败时可就地重试；
 * 切换国家时立即清空已选城市与旧选项，只采用最新一次城市请求的结果。
 */
export function useLocationOptions(form: RequestForm) {
  const countryOptions = ref<DictItem[]>([])
  const cityOptions = ref<DictItem[]>([])
  const loadingCountries = ref(false)
  const loadingCities = ref(false)
  const countriesFailed = ref(false)
  const citiesFailed = ref(false)
  let citySeq = 0

  async function loadCountries() {
    loadingCountries.value = true
    countriesFailed.value = false
    try { countryOptions.value = await getCountries() }
    catch { countryOptions.value = []; countriesFailed.value = true }
    finally { loadingCountries.value = false }
  }

  async function loadCities(countryCode = form.countryCode) {
    const seq = ++citySeq
    cityOptions.value = []
    citiesFailed.value = false
    if (!countryCode) { loadingCities.value = false; return }
    loadingCities.value = true
    try {
      const items = await getCities(countryCode)
      if (seq === citySeq) cityOptions.value = items
    } catch { if (seq === citySeq) citiesFailed.value = true }
    finally { if (seq === citySeq) loadingCities.value = false }
  }

  watch(() => form.countryCode, countryCode => {
    form.city = ''
    void loadCities(countryCode)
  })
  onMounted(() => {
    void loadCountries()
    void loadCities()
  })

  return { countryOptions, cityOptions, loadingCountries, loadingCities, countriesFailed, citiesFailed, loadCountries, loadCities }
}
