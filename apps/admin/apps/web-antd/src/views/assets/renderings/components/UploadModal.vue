<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import { h, markRaw, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { uploadAssetApi } from '#/api/core/assets';

import { readImageSize, renderingSizeError } from '../../shared/image-spec';
import { useSchemeOptions } from '../../shared/scheme-filter';

const emit = defineEmits(['reload']);

const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();

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
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.jpg,.jpeg,.png,.webp',
        beforeUpload: async (
          file: File,
        ): Promise<boolean | typeof Upload.LIST_IGNORE> => {
          try {
            const error = renderingSizeError(await readImageSize(file));
            if (!error) return false;
            message.error(error);
          } catch (error) {
            message.error((error as Error).message);
          }
          return Upload.LIST_IGNORE;
        },
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
            h(
              'p',
              { class: 'ant-upload-hint' },
              '需为严格 16:9（如 1600×900），支持 jpg, png, webp 格式',
            ),
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
        type: 'rendering',
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
      schemes.search();
    } else {
      schemeCode.value = undefined;
      schemes.clear();
      formApi.resetForm();
    }
  },
});

function open(defaultSchemeCode?: string) {
  schemeCode.value = defaultSchemeCode;
  schemes.pin(defaultSchemeCode);
  modalApi.open();
}
defineExpose({ open });
</script>

<template>
  <Modal class="w-[520px]" title="上传效果图">
    <div class="px-4 pb-2">
      <div class="mb-4">
        <label class="mb-1 block text-sm font-medium">归属方案</label>
        <Select
          v-model:value="schemeCode"
          :options="schemes.options.value"
          :loading="schemes.loading.value"
          show-search
          :filter-option="false"
          allow-clear
          placeholder="搜索方案编号或名称"
          class="w-full"
          @search="schemes.onSearch"
        />
      </div>
      <Form />
    </div>
  </Modal>
</template>
