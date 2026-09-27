<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import { h, markRaw, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { debounce } from '@vben/utils';

import { message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { uploadAssetApi } from '#/api/core/assets';
import { getSchemeListApi } from '#/api/core/schemes';

const emit = defineEmits(['reload']);

const schemeCode = ref<string | undefined>(undefined);
const schemeOptions = ref<{ label: string; value: string }[]>([]);
const schemeLoading = ref(false);

const VIEW_CODE_OPTIONS = [
  { label: '正视图', value: 'front' },
  { label: '侧视图', value: 'side' },
  { label: '俯视图', value: 'top' },
  { label: '背视图', value: 'back' },
  { label: '透视图', value: 'perspective' },
  { label: '剖面图', value: 'section' },
];

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
  },
  layout: 'vertical',
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
    {
      component: 'Select' as const,
      fieldName: 'viewCodes',
      label: '视向',
      componentProps: {
        options: VIEW_CODE_OPTIONS,
        mode: 'multiple',
        placeholder: '请选择图纸视向（可多选）',
        allowClear: true,
      },
    },
    {
      component: 'Input' as const,
      fieldName: 'purpose',
      label: '用途',
      componentProps: { placeholder: '如：展台搭建用报馆图' },
    },
    {
      component: 'Input' as const,
      fieldName: 'applicability',
      label: '适用范围',
      componentProps: { placeholder: '如：适用于国内展馆' },
    },
    {
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.pdf,.png,.jpg,.jpeg',
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
            h('p', { class: 'ant-upload-hint' }, '支持 PDF 或图片格式'),
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
    const uploadedFileList = values.file as undefined | UploadFile[];
    const file = uploadedFileList?.[0]?.originFileObj;
    if (!file) {
      message.error('请选择文件');
      return;
    }
    try {
      modalApi.setState({ confirmLoading: true });
      const metadata: Record<string, unknown> = {};
      if (values.viewCodes?.length) metadata.viewCodes = values.viewCodes;
      if (values.purpose) metadata.purpose = values.purpose;
      if (values.applicability) metadata.applicability = values.applicability;
      await uploadAssetApi(schemeCode.value, {
        type: 'drawing',
        name: values.name,
        file: file as File,
        ...(Object.keys(metadata).length > 0
          ? { metadata: JSON.stringify(metadata) }
          : {}),
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
  <Modal class="w-[520px]" title="上传报馆图">
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
