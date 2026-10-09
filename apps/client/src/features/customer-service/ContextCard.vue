<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Box, BriefcaseBusiness } from 'lucide-vue-next'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import { getProjectStatusLabels } from '@/features/projects/labels'
import { contextThemeCoverUrl, type ContextDto } from '@/services/api/customer-service'
import { schemeCoverUrl } from '@/services/api/selection'

// 会话上下文卡片：只展示服务端白名单快照；方案卡片带封面小图，点击放大（方案下架或无图时退回图标）
// 从换主题结果页发出的方案卡片展示发送时选定的效果图
const props = defineProps<{ context: ContextDto }>()
const { t } = useI18n()
const themed = computed(() => props.context.kind === 'scheme' && !!props.context.snapshot.themeResultId)
const cover = computed(() => {
  if (props.context.kind !== 'scheme') return ''
  return themed.value ? contextThemeCoverUrl(props.context.id) : schemeCoverUrl(props.context.snapshot.schemeCode)
})
const coverAlt = computed(() => {
  if (props.context.kind !== 'scheme') return ''
  const code = props.context.snapshot.schemeCode
  return themed.value ? `${t('customerService.themedEffect')} · ${code}` : t('gallery.effectAlt', { code, index: 1 })
})
const projectStatusLabels = computed(() => getProjectStatusLabels(t))
const coverFailed = ref(false)
const previewOpen = ref(false)
const previewFailed = ref(false)

function openPreview() {
  previewFailed.value = false
  previewOpen.value = true
}
</script>

<template>
  <div class="mx-auto flex max-w-[90%] items-start gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm">
    <template v-if="context.kind === 'scheme'">
      <button
        v-if="!coverFailed"
        type="button"
        class="aspect-video w-20 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('gallery.enlargeImage', { code: context.snapshot.schemeCode, index: 1 })"
        data-cs-scheme-cover
        @click="openPreview"
      >
        <img
          :src="cover"
          :alt="coverAlt"
          loading="lazy"
          class="size-full object-cover transition-transform hover:scale-105"
          @error="coverFailed = true"
        >
      </button>
      <Box v-else class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">
          {{ t('customerService.contextScheme') }} · <span class="font-mono">{{ context.snapshot.schemeCode }}</span>
          <template v-if="themed"> · <span data-cs-themed>{{ t('customerService.themedEffect') }}</span></template>
        </p>
        <p class="truncate font-medium">{{ context.snapshot.name }}</p>
        <p class="text-xs text-muted-foreground">
          <template v-if="context.snapshot.lengthMm && context.snapshot.widthMm">{{ context.snapshot.lengthMm / 1000 }} × {{ context.snapshot.widthMm / 1000 }} m</template>
          <template v-if="context.snapshot.openingCount"> · {{ t('customerService.openings', { count: context.snapshot.openingCount }) }}</template>
        </p>
      </div>
      <ImagePreviewDialog
        v-model:open="previewOpen"
        :src="cover"
        :alt="coverAlt"
        :title="context.snapshot.name"
        :description="context.snapshot.schemeCode"
        :image-error="previewFailed"
        @image-error="previewFailed = true"
      />
    </template>
    <template v-else>
      <BriefcaseBusiness class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">{{ t('customerService.contextProject') }} · <span class="font-mono">{{ context.snapshot.projectNo }}</span></p>
        <p class="truncate font-medium">{{ context.snapshot.exhibitionName }}</p>
        <p class="text-xs text-muted-foreground">{{ context.snapshot.city }} · {{ projectStatusLabels[context.snapshot.status] ?? context.snapshot.status }}</p>
      </div>
    </template>
  </div>
</template>
