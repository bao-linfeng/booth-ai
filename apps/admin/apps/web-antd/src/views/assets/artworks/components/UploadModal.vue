<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { debounce } from '@vben/utils';

import { message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { uploadAssetApi } from '#/api/core/assets';
import { getSchemeListApi } from '#/api/core/schemes';

const emit = defineEmits(['reload']);

const fileList = ref<UploadFile[]>([]);

const schemeCode = ref<string | undefined>(undefined);
const schemeOptions = ref<{ label: string; value: string }[]>([]);
const schemeLoading = ref(false);

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

const handleSearch = debounce((value: string) => {
  fetchSchemes(value || undefined);
}, 300);

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
    labelWidth: 80,
  },
  layout: 'horizontal',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '资源名称',
      rules: 'required',
      componentProps: { placeholder: '请输入资源名称' },
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

    if (fileList.value.length === 0) {
      message.error('请选择文件');
      return;
    }

    const file = fileList.value[0]?.originFileObj;
    if (!file) return;

    try {
      modalApi.setState({ confirmLoading: true });
      const values = await formApi.getValues();
      await uploadAssetApi(schemeCode.value, {
        type: 'artwork',
        name: values.name,
        file: file as File,
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
      fileList.value = [];
      schemeCode.value = undefined;
      schemeOptions.value = [];
      formApi.resetForm();
    }
  },
});

function open() {
  modalApi.open();
}
defineExpose({ open });

const beforeUpload = (file: File) => {
  fileList.value = [file as unknown as UploadFile];
  return false;
};

const handleRemove = () => {
  fileList.value = [];
};
</script>

<template>
  <Modal class="w-[520px]" title="上传平面素材">
    <div class="px-4 pb-2">
      <div class="mb-4">
        <div class="mb-1 flex items-center gap-1 text-sm">
          <span class="text-red-500">*</span>
          <span class="font-medium" style="min-width: 80px">归属方案</span>
        </div>
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
      <div class="mt-2">
        <div class="mb-2 flex items-center gap-1 text-sm">
          <span class="text-red-500">*</span>
          <span class="font-medium" style="min-width: 80px">上传文件</span>
        </div>
        <Upload.Dragger
          v-model:file-list="fileList"
          :max-count="1"
          :before-upload="beforeUpload"
          @remove="handleRemove"
          accept=".png,.jpg,.jpeg,.webp"
        >
          <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p class="ant-upload-hint">支持图片格式（PNG 推荐）</p>
        </Upload.Dragger>
      </div>
    </div>
  </Modal>
</template>
