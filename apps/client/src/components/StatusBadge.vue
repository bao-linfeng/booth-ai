<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'
import { cva } from 'class-variance-authority'
import { Badge } from '@/components/ui/badge'
import { getProjectStatusLabels } from '@/features/projects/labels'
import { getThemeJobStatusLabels } from '@/features/theme-jobs/labels'
import type { ProjectStatus } from '@/services/api/projects'
import type { ThemeJob } from '@/services/api/theme-jobs'
import { cn } from '@/lib/utils'

type JobStatus = ThemeJob['status']
type ArtworkStatus = 'pending' | 'submitting' | 'generated' | 'succeeded' | 'failed'
type Tone = 'pending' | 'active' | 'success' | 'muted' | 'failed' | 'partial'

const props = defineProps<{
  domain: 'project' | 'job' | 'artwork'
  status: string
  label?: string
  class?: HTMLAttributes['class']
}>()
const { t } = useI18n()
const jobStatusLabels = computed(() => getThemeJobStatusLabels(t))

const styles = cva('inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      pending: 'border-warning/25 bg-warning/10 text-warning',
      active: 'border-info/25 bg-info/10 text-info',
      success: 'border-success/25 bg-success/10 text-success',
      muted: 'bg-muted text-muted-foreground',
      failed: 'border-destructive/25 bg-destructive/10 text-destructive',
      partial: 'border-warning/25 bg-warning/10 text-warning',
    },
  },
})

const projectTones: Record<ProjectStatus, Tone> = {
  pending: 'pending',
  following: 'active',
  quoted: 'active',
  won: 'success',
  lost: 'muted',
  closed: 'muted',
}

const artworkLabels = computed<Record<ArtworkStatus, string>>(() => ({
  pending: t('artworkJob.statusPending'),
  submitting: t('artworkJob.statusSubmitting'),
  generated: t('artworkJob.statusGenerated'),
  succeeded: t('artworkJob.statusSucceeded'),
  failed: t('artworkJob.statusFailed'),
}))

const projectLabels = computed(() => getProjectStatusLabels(t))

const tone = computed<Tone>(() => {
  if (props.domain === 'project') return projectTones[props.status as ProjectStatus] ?? 'muted'
  if (props.domain === 'artwork') {
    const status = props.status as ArtworkStatus
    if (status === 'pending') return 'pending'
    if (status === 'submitting' || status === 'generated') return 'active'
    if (status === 'succeeded') return 'success'
    if (status === 'failed') return 'failed'
    return 'muted'
  }

  const status = props.status as JobStatus
  if (status === 'pending') return 'pending'
  if (['queued', 'running', 'settling'].includes(status)) return 'active'
  if (status === 'succeeded') return 'success'
  if (status === 'partially_succeeded') return 'partial'
  return 'failed'
})

const defaultLabel = computed(() => {
  if (props.domain === 'project') return projectLabels.value[props.status as ProjectStatus] ?? props.status
  if (props.domain === 'artwork') return artworkLabels.value[props.status as ArtworkStatus] ?? props.status
  return jobStatusLabels.value[props.status as JobStatus] ?? props.status
})
</script>

<template>
  <Badge :class="cn(styles({ tone }), props.class)">
    <slot />{{ label ?? defaultLabel }}
  </Badge>
</template>
