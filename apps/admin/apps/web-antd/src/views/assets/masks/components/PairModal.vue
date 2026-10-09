<script setup lang="ts">
import type { RenderingPairOption } from '../../shared/pairing';

import type { SchemeAsset } from '#/api/core/assets';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, message, Select } from 'ant-design-vue';

import { listSchemeAssetsApi, updateAssetApi } from '#/api/core/assets';

import { renderingPairOptions } from '../../shared/pairing';

const emit = defineEmits(['reload']);

const mask = ref<SchemeAsset>();
const options = ref<RenderingPairOption[]>([]);
const loading = ref(false);
// 关闭弹窗或改为其他蒙版打开时作废进行中的加载，旧回包不能覆盖当前候选
let loadSequence = 0;
const renderingId = ref<string>();

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    if (!mask.value) return;
    if (!renderingId.value) {
      message.error('请选择配对效果图');
      return;
    }
    if (renderingId.value === mask.value.relatedAssetId) {
      modalApi.close();
      return;
    }
    try {
      modalApi.setState({ confirmLoading: true });
      await updateAssetApi(mask.value.schemeCode, mask.value.id, {
        relatedAssetId: renderingId.value,
        expectedRevision: mask.value.revision,
      });
      message.success('配对已更新，排序已跟随效果图，方案需重新审核');
      modalApi.close();
      emit('reload');
    } catch (error) {
      // 接口错误已由请求拦截器提示具体原因
      console.error(error);
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  onOpenChange: (isOpen) => {
    if (!isOpen) {
      loadSequence++;
      loading.value = false;
      mask.value = undefined;
      options.value = [];
      renderingId.value = undefined;
    }
  },
});

async function open(row: SchemeAsset) {
  const current = ++loadSequence;
  mask.value = row;
  renderingId.value = row.relatedAssetId ?? undefined;
  options.value = [];
  modalApi.open();
  loading.value = true;
  try {
    const [renderings, masks] = await Promise.all([
      listSchemeAssetsApi(row.schemeCode, 'rendering'),
      listSchemeAssetsApi(row.schemeCode, 'mask'),
    ]);
    if (current !== loadSequence) return;
    options.value = renderingPairOptions(row, renderings, masks);
  } catch (error) {
    console.error(error);
    if (current === loadSequence) options.value = [];
  } finally {
    if (current === loadSequence) loading.value = false;
  }
}
defineExpose({ open });
</script>

<template>
  <Modal
    class="w-[520px]"
    :title="mask?.relatedAssetId ? '改配效果图' : '配对效果图'"
  >
    <div class="px-4 pb-2">
      <Alert
        v-if="mask && !mask.relatedAssetId"
        class="mb-4"
        type="warning"
        show-icon
        message="该蒙版未配对效果图，无法叠加预览，方案也无法发布"
      />
      <label class="mb-1 block text-sm font-medium">配对效果图</label>
      <Select
        v-model:value="renderingId"
        :options="options"
        :loading="loading"
        class="w-full"
        placeholder="选择同方案下尺寸一致且未配对的效果图"
        not-found-content="该方案暂无效果图"
      />
    </div>
  </Modal>
</template>
