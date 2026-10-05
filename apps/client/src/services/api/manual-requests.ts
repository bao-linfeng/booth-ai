import { apiFetch } from '@/lib/api-client'
import type { Requirement } from '@/features/selection/types'
import type { ProjectReceipt, QuoteRequest } from './quote-requests'

export interface ManualRequest extends Omit<QuoteRequest, 'schemeCode' | 'schemeRevision' | 'bomRevision' | 'drawingRevision' | 'artworkRevision' | 'artworkJobId' | 'themeSelection' | 'requirementContext' | 'entryPoint'> {
  entryPoint: 'matching_results'; originalDescription: string; confirmedRequirements: Requirement; parsedRequirements?: Requirement; unresolvedQuestions?: string[];
}

export async function submitManualRequest(input: ManualRequest): Promise<ProjectReceipt> {
  return (await apiFetch<{ code: number; data: ProjectReceipt }>('/api/v1/client/manual-requests', { method: 'POST', body: input, retry: 0 })).data
}
