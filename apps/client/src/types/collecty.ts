import type { ComputedRef } from 'vue'

export interface SectionData {
  id: ComputedRef<string>
  isInCollection: ComputedRef<boolean>
  toggleCollection: () => void
} 