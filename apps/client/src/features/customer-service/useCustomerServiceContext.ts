import { computed, onBeforeUnmount, watch } from 'vue'
import type { EntryPoint } from '@/services/api/customer-service'
import { openWith, setPageContext, type PageContext } from './useCustomerService'

interface SchemeContext { schemeCode: string; themeJobId?: string }
interface ProjectContext { projectId: string; projectNo: string }

function useCustomerServiceContext(source: () => PageContext | null) {
  const current = computed(source)
  watch(current, setPageContext, { immediate: true })
  onBeforeUnmount(() => setPageContext(null))

  async function consult() {
    const page = current.value
    if (page) await openWith(page.context, page.entryPoint)
  }

  return { consult }
}

export function useSchemeCustomerService(source: () => SchemeContext | null | undefined, entryPoint: EntryPoint = 'scheme_detail') {
  return useCustomerServiceContext(() => {
    const scheme = source()
    if (!scheme) return null
    return {
      context: { kind: 'scheme', schemeCode: scheme.schemeCode, ...(scheme.themeJobId ? { themeJobId: scheme.themeJobId } : {}) },
      entryPoint,
      label: scheme.schemeCode,
    }
  })
}

export function useProjectCustomerService(source: () => ProjectContext | null | undefined, entryPoint: EntryPoint = 'my_project') {
  return useCustomerServiceContext(() => {
    const project = source()
    if (!project) return null
    return {
      context: { kind: 'project', projectId: project.projectId },
      entryPoint,
      label: project.projectNo,
    }
  })
}
