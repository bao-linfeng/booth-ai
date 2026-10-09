<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Box, BriefcaseBusiness } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useCustomerService } from './useCustomerService'

// 一键发送当前方案/项目：仅在方案详情页或项目详情页登记了上下文时显示在输入框上方，每次点击都发出一张卡片
const { t } = useI18n()
const { state, pageContext, sendPageContext } = useCustomerService()
const project = computed(() => pageContext.value?.context.kind === 'project')
</script>

<template>
  <Button
    v-if="pageContext"
    type="button"
    variant="outline"
    size="xs"
    class="flex h-6 w-fit max-w-full gap-1 rounded-full px-2 text-xs font-normal text-muted-foreground [&_svg]:size-3"
    :disabled="state.busy"
    :title="`${t(project ? 'customerService.contextProject' : 'customerService.contextScheme')} · ${pageContext.label}`"
    data-cs-send-context
    @click="sendPageContext"
  >
    <BriefcaseBusiness v-if="project" aria-hidden="true" />
    <Box v-else aria-hidden="true" />
    <span class="truncate">{{ t(project ? 'customerService.sendProject' : 'customerService.sendScheme') }}</span>
  </Button>
</template>
