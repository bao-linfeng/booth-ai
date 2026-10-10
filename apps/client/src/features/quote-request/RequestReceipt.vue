<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { CheckCircle2, MessageCircle } from 'lucide-vue-next'
import { useProjectCustomerService } from '@/features/customer-service/useCustomerServiceContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ProjectReceipt } from '@/services/api/quote-requests'

// 受理回执；未登录提交时提示按联系邮箱认领，并引导登录查看项目
const props = defineProps<{ receipt: ProjectReceipt; loggedIn: boolean; guestEmail: string; artworkFixed: boolean }>()
defineEmits<{ login: []; 'new-request': [] }>()
const { t } = useI18n()

const { consult } = useProjectCustomerService(() => props.receipt, 'quote_receipt')
</script>

<template>
  <Card class="border-success/25"><CardContent class="space-y-6 p-6 md:p-12">
    <CheckCircle2 class="size-12 text-success" /><div><p class="mb-2 text-sm text-success">{{ t('quoteRequest.successTitle') }}</p><h1 class="studio-title">{{ t('quoteRequest.successSubtitle') }}</h1></div>
    <dl class="grid gap-4 rounded-lg bg-muted p-5 sm:grid-cols-2"><div><dt class="text-sm text-muted-foreground">{{ t('quoteRequest.successProjectId') }}</dt><dd class="mt-1 font-mono text-xl">{{ receipt.projectNo }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('quoteRequest.successRequestId') }}</dt><dd class="mt-1 break-all font-mono text-sm">{{ receipt.requestNo }}</dd></div></dl>
    <p class="text-sm leading-6 text-muted-foreground">{{ t('quoteRequest.successNote') }}</p>
    <p v-if="receipt.materialsStatus?.artworks === 'pending'" class="text-sm">{{ t('quoteRequest.successThemePending') }}</p>
    <p v-if="artworkFixed && receipt.materialsStatus?.artworks === 'available'" class="text-sm">{{ t('quoteRequest.successArtworkFixed') }}</p>
    <template v-if="loggedIn"><Button as-child><RouterLink :to="`/my-projects/${receipt.projectId}`">{{ t('quoteRequest.viewProjects') }}</RouterLink></Button></template>
    <template v-else><p class="text-sm leading-6">{{ t('quoteRequest.successGuestNote', { email: guestEmail }) }}</p><Button @click="$emit('login')">{{ t('quoteRequest.loginToTrack') }}</Button></template>
    <Button variant="outline" class="ml-3" @click="$emit('new-request')">{{ t('quoteRequest.submitAnother') }}</Button>
    <Button variant="outline" class="ml-3" @click="consult"><MessageCircle class="mr-2 size-4" aria-hidden="true" />{{ t('customerService.consult') }}</Button>
  </CardContent></Card>
</template>
