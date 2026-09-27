<script setup lang="ts">
import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Slider, Spin } from 'ant-design-vue';

import { getAssetDownloadUrlApi } from '#/api/core/assets';

const opacity = ref<number>(60);
const renderingUrl = ref<string>('');
const maskUrl = ref<string>('');
const loading = ref<boolean>(false);
const errorMsg = ref<string>('');

const [Modal, modalApi] = useVbenModal({
  onOpenChange: (isOpen) => {
    if (!isOpen) {
      renderingUrl.value = '';
      maskUrl.value = '';
      opacity.value = 60;
      errorMsg.value = '';
    }
  },
});

async function open(maskRow: any, renderingRow: any) {
  modalApi.open();
  loading.value = true;
  errorMsg.value = '';

  try {
    const [renderingRes, maskRes] = await Promise.all([
      getAssetDownloadUrlApi(
        renderingRow.schemeCode,
        renderingRow.id,
        'preview',
      ),
      getAssetDownloadUrlApi(maskRow.schemeCode, maskRow.id, 'preview'),
    ]);

    renderingUrl.value = renderingRes.url;
    maskUrl.value = maskRes.url;
  } catch (error: any) {
    console.error('Failed to get asset download URLs:', error);
    errorMsg.value = error?.message || '获取预览地址失败';
  } finally {
    loading.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <Modal class="w-[840px]" title="叠加预览" :footer="false">
    <div class="px-4 pb-4">
      <div class="mb-4 flex items-center gap-4">
        <span class="text-sm font-medium">蒙版透明度</span>
        <div class="flex-1">
          <Slider v-model:value="opacity" :min="0" :max="100" />
        </div>
        <span class="w-10 text-right text-sm">{{ opacity }}%</span>
      </div>

      <div
        class="relative flex h-[600px] w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
      >
        <Spin v-if="loading" />
        <div v-else-if="errorMsg" class="text-destructive">{{ errorMsg }}</div>
        <template v-else-if="renderingUrl && maskUrl">
          <img
            :src="renderingUrl"
            class="absolute h-full w-full object-contain"
            alt="效果图"
          />
          <img
            :src="maskUrl"
            class="absolute h-full w-full object-contain"
            :style="{ opacity: opacity / 100 }"
            alt="蒙版"
          />
        </template>
      </div>
    </div>
  </Modal>
</template>
