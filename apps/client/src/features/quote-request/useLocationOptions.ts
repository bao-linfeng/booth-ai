import { onMounted, ref, watch } from 'vue'
import { getCities, getCountries, type DictItem } from '@/services/api/dictionary'
import type { RequestForm } from './form'

/** 国家、城市下拉选项；切换国家时清空已选城市并重新加载，字典不可用时选项为空 */
export function useLocationOptions(form: RequestForm) {
  const countryOptions = ref<DictItem[]>([])
  const cityOptions = ref<DictItem[]>([])
  const loadingCountries = ref(false)
  const loadingCities = ref(false)

  async function loadCountries() {
    loadingCountries.value = true
    try { countryOptions.value = await getCountries() }
    catch { countryOptions.value = [] }
    finally { loadingCountries.value = false }
  }

  async function loadCities(countryCode: string) {
    if (!countryCode) { cityOptions.value = []; return }
    loadingCities.value = true
    try { cityOptions.value = await getCities(countryCode) }
    catch { cityOptions.value = [] }
    finally { loadingCities.value = false }
  }

  watch(() => form.countryCode, countryCode => {
    form.city = ''
    void loadCities(countryCode)
  })
  onMounted(() => {
    void loadCountries()
    void loadCities(form.countryCode)
  })

  return { countryOptions, cityOptions, loadingCountries, loadingCities }
}
