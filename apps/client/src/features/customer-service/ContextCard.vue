<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Box, BriefcaseBusiness } from 'lucide-vue-next'
import type { ContextDto } from '@/services/api/customer-service'

// 会话上下文卡片：只展示服务端白名单快照
defineProps<{ context: ContextDto }>()
const { t } = useI18n()
</script>

<template>
  <div class="mx-auto flex max-w-[90%] items-start gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm">
    <template v-if="context.kind === 'scheme'">
      <Box class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">{{ t('customerService.contextScheme') }} · <span class="font-mono">{{ context.snapshot.schemeCode }}</span></p>
        <p class="truncate font-medium">{{ context.snapshot.name }}</p>
        <p class="text-xs text-muted-foreground">
          <template v-if="context.snapshot.lengthMm && context.snapshot.widthMm">{{ context.snapshot.lengthMm / 1000 }} × {{ context.snapshot.widthMm / 1000 }} m</template>
          <template v-if="context.snapshot.openingCount"> · {{ t('customerService.openings', { count: context.snapshot.openingCount }) }}</template>
        </p>
      </div>
    </template>
    <template v-else>
      <BriefcaseBusiness class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">{{ t('customerService.contextProject') }} · <span class="font-mono">{{ context.snapshot.projectNo }}</span></p>
        <p class="truncate font-medium">{{ context.snapshot.exhibitionName }}</p>
        <p class="text-xs text-muted-foreground">{{ context.snapshot.city }} · {{ context.snapshot.status }}</p>
      </div>
    </template>
  </div>
</template>
