<script setup lang="ts">
import { ref, watch } from 'vue'
import { Expand, ImageOff } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import BoothIllustration from './BoothIllustration.vue'
import type { SchemeImage } from './types'
const props = withDefaults(defineProps<{ images: SchemeImage[]; code: string; preview?: boolean; variant?: number }>(), { preview: false, variant: 0 })
const active = ref(0)
const expanded = ref(false)
const failed = ref(false)
watch(() => props.code, () => { active.value = 0; failed.value = false })
watch(active, () => { failed.value = false })
</script>

<template>
  <div class="min-w-0 space-y-3">
    <Button variant="ghost" :class="cn('relative block aspect-video h-auto w-full overflow-hidden rounded-lg bg-muted p-0 hover:bg-muted')" :aria-label="`放大 ${code} 第 ${active + 1} 张图片`" @click="expanded = true">
      <BoothIllustration v-if="preview" :variant="variant" :view="active" class="h-full w-full" />
      <span v-else-if="failed" class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><ImageOff />图片暂不可用</span>
      <img v-else :src="images[active]?.thumbnailUrl" :alt="`${code} 第 ${active + 1} 张效果图`" class="h-full w-full object-cover" loading="lazy" @error="failed = true" />
      <span class="absolute bottom-3 left-3 rounded bg-background/90 px-2 py-1 font-mono text-xs">{{ active + 1 }} / {{ images.length }}</span><Expand class="absolute bottom-3 right-3 size-7 rounded bg-background/90 p-1.5" />
    </Button>
    <div class="grid grid-cols-3 gap-2" aria-label="切换方案图片"><Button v-for="(image, index) in images" :key="image.assetId" variant="outline" :class="cn('h-auto flex-col gap-0 overflow-hidden p-0', active === index && 'border-primary ring-1 ring-primary')" :aria-label="`查看第 ${index + 1} 张`" :aria-pressed="active === index" @click="active = index"><BoothIllustration v-if="preview" :variant="variant" :view="index" class="aspect-video w-full" /><img v-else :src="image.thumbnailUrl" alt="" loading="lazy" class="aspect-video w-full object-cover" /><span class="py-1 text-xs">{{ ['主视角', '侧视角', '空间视角'][index] }}</span></Button></div>
    <Dialog v-model:open="expanded"><DialogContent class="max-h-[90dvh] max-w-5xl overflow-y-auto"><DialogTitle>{{ code }} · {{ active + 1 }} / {{ images.length }}</DialogTitle><DialogDescription>{{ preview ? '空间示意，非真实方案效果图。' : '方案效果图，仅作视觉及空间参考。' }}</DialogDescription><BoothIllustration v-if="preview" :variant="variant" :view="active" class="w-full" /><img v-else :src="images[active]?.url" :alt="`${code} 原始效果图`" class="w-full" /><div class="flex justify-center gap-2"><Button v-for="(_, index) in images" :key="index" :variant="active === index ? 'default' : 'outline'" :aria-pressed="active === index" @click="active = index">视角 {{ index + 1 }}</Button></div></DialogContent></Dialog>
  </div>
</template>
