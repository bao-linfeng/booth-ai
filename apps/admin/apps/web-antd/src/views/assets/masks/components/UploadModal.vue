<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import { h, markRaw, ref, watch } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { debounce } from '@vben/utils';

import { message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { listSchemeAssetsApi, uploadAssetApi } from '#/api/core/assets';
import { getSchemeListApi } from '#/api/core/schemes';

const emit = defineEmits(['reload']);

const schemeCode = ref<string | undefined>(undefined);
const schemeOptions = ref<{ label: string; value: string }[]>([]);
const schemeLoading = ref(false);
const renderingOptions = ref<{ label: string; value: string }[]>([]);
const renderingLoading = ref(false);

async function fetchSchemes(keyword?: string) {
  schemeLoading.value = true;
  try {
    const res = await getSchemeListApi({
      ...(keyword ? { code: keyword } : {}),
      pageSize: 20,
    });
    schemeOptions.value = (res.data ?? []).map((item) => ({
      label: `${item.code} - ${item.name}`,
      value: item.code,
    }));
  } finally {
    schemeLoading.value = false;
  }
}

async function fetchRenderings(code: string) {
  renderingLoading.value = true;
  try {
    const assets = await listSchemeAssetsApi(code, 'rendering');
    renderingOptions.value = assets.map((a) => ({
      label: a.name,
      value: a.id,
    }));
  } catch {
    renderingOptions.value = [];
  } finally {
    renderingLoading.value = false;
  }
}

watch(schemeCode, (code) => {
  renderingOptions.value = [];
  formApi.setFieldValue('relatedAssetId', undefined);
  if (code) fetchRenderings(code);
});

const handleSearch = debounce((value: string) => {
  fetchSchemes(value || undefined);
}, 300);

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  layout: 'vertical',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Select' as const,
      fieldName: 'relatedAssetId',
      label: '配对效果图',
      rules: 'required',
      componentProps: () => ({
        options: renderingOptions.value,
        loading: renderingLoading.value,
        placeholder: '请先选择归属方案，再选择配对效果图',
        allowClear: true,
        notFoundContent: schemeCode.value
          ? '该方案暂无效果图'
          : '请先选择归属方案',
      }),
    },
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '资源名称',
      rules: 'required',
      componentProps: { placeholder: '请输入资源名称' },
    },
    {
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.png,.jpg,.jpeg,.webp',
        beforeUpload: () => false,
        maxCount: 1,
      },
      renderComponentContent: () => ({
        default: () =>
          h('div', [
            h('p', { class: 'ant-upload-drag-icon' }, [
              h(IconifyIcon, {
                icon: 'ant-design:inbox-outlined',
                class: 'mx-auto size-10 text-primary',
              }),
            ]),
            h('p', { class: 'ant-upload-text' }, '点击或拖拽文件到此区域上传'),
            h('p', { class: 'ant-upload-hint' }, '支持图片格式（PNG 推荐）'),
          ]),
      }),
    },
  ],
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    if (!schemeCode.value) {
      message.error('请选择归属方案');
      return;
    }

    const { valid } = await formApi.validate();
    if (!valid) return;

    const values = await formApi.getValues();
    const fileList = values.file as undefined | UploadFile[];
    const file = fileList?.[0]?.originFileObj;
    if (!file) {
      message.error('请选择文件');
      return;
    }

    try {
      modalApi.setState({ confirmLoading: true });
      await uploadAssetApi(schemeCode.value, {
        type: 'mask',
        name: values.name,
        file: file as File,
        relatedAssetId: values.relatedAssetId,
      });
      message.success('上传成功');
      modalApi.close();
      emit('reload');
    } catch (error) {
      console.error(error);
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  onOpenChange: (isOpen) => {
    if (isOpen) {
      fetchSchemes();
    } else {
      schemeCode.value = undefined;
      schemeOptions.value = [];
      renderingOptions.value = [];
      formApi.resetForm();
    }
  },
});

function open() {
  modalApi.open();
}
defineExpose({ open });
</script>

<template>
  <Modal class="w-[520px]" title="上传蒙版">
    <div class="px-4 pb-2">
      <div class="mb-4">
        <label class="mb-1 block text-sm font-medium">归属方案</label>
        <Select
          v-model:value="schemeCode"
          :options="schemeOptions"
          :loading="schemeLoading"
          show-search
          :filter-option="false"
          allow-clear
          placeholder="搜索方案编号或名称"
          class="w-full"
          @search="handleSearch"
        />
      </div>
      <Form />
    </div>
  </Modal>
</template>
