<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import { h, markRaw, onBeforeUnmount, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { Button, Input, message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { uploadAssetApi } from '#/api/core/assets';

// 效果图 16:9 校验暂时关闭
// import { readImageSize, renderingSizeError } from '../../shared/image-spec';
import { useSchemeOptions } from '../../shared/scheme-filter';
import { createUploadKeys } from '../../shared/upload-key';
import { defaultAssetName } from '../../shared/upload-name';

const emit = defineEmits(['reload']);

const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();
const uploadKeys = createUploadKeys();
/** 已选文件及各自的资源名称（按 uid 对应），默认取文件原始名称（不含扩展名） */
const files = ref<UploadFile[]>([]);
const names = ref<Record<string, string>>({});
/** 本地预览图，文件移除或弹窗关闭时释放 */
const previews = new Map<string, string>();
const previewUrls = ref<Record<string, string>>({});

function syncFiles(fileList: undefined | UploadFile[]) {
  files.value = fileList ?? [];
  const uids = new Set(files.value.map((item) => item.uid));
  for (const [uid, url] of previews) {
    if (!uids.has(uid)) {
      URL.revokeObjectURL(url);
      previews.delete(uid);
    }
  }
  for (const item of files.value) {
    if (!previews.has(item.uid) && item.originFileObj)
      previews.set(item.uid, URL.createObjectURL(item.originFileObj));
  }
  previewUrls.value = Object.fromEntries(previews);
  names.value = Object.fromEntries(
    files.value.map((item) => [
      item.uid,
      names.value[item.uid] ?? defaultAssetName(item.name),
    ]),
  );
}

onBeforeUnmount(() => syncFiles([]));

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  layout: 'vertical',
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  handleValuesChange: (values, fieldsChanged) => {
    if (fieldsChanged.includes('file'))
      syncFiles(values.file as undefined | UploadFile[]);
  },
  schema: [
    {
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.jpg,.jpeg,.png,.webp',
        // 效果图 16:9 校验暂时关闭，恢复时还原下面的 beforeUpload
        beforeUpload: (): boolean => false,
        // beforeUpload: async (
        //   file: File,
        // ): Promise<boolean | typeof Upload.LIST_IGNORE> => {
        //   try {
        //     const error = renderingSizeError(await readImageSize(file));
        //     if (!error) return false;
        //     message.error(`${file.name}：${error}`);
        //   } catch (error) {
        //     message.error((error as Error).message);
        //   }
        //   return Upload.LIST_IGNORE;
        // },
        multiple: true,
        // 已选文件在下方逐行展示并填写名称，不再重复显示默认列表
        showUploadList: false,
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
              '可一次选择多张，支持 jpg, png, webp 格式',
            ),
          ]),
      }),
    },
  ],
});

function removeFile(uid: string) {
  formApi.setFieldValue(
    'file',
    files.value.filter((item) => item.uid !== uid),
  );
}

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    if (!schemeCode.value) {
      message.error('请选择归属方案');
      return;
    }
    const { valid } = await formApi.validate();
    if (!valid) return;
    const fileList = files.value;
    if (fileList.length === 0) {
      message.error('请选择文件');
      return;
    }
    if (fileList.some((item) => !names.value[item.uid]?.trim())) {
      message.error('请填写资源名称');
      return;
    }
    const failed: UploadFile[] = [];
    modalApi.setState({ confirmLoading: true });
    try {
      for (const item of fileList) {
        const file = item.originFileObj as File | undefined;
        const name = names.value[item.uid]?.trim();
        if (!file || !name) continue;
        try {
          await uploadAssetApi(schemeCode.value, {
            type: 'rendering',
            name,
            file,
            idempotencyKey: uploadKeys.forFile(file),
          });
        } catch (error) {
          console.error(error);
          failed.push(item);
        }
      }
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
    const succeeded = fileList.length - failed.length;
    if (succeeded > 0) emit('reload');
    if (failed.length === 0) {
      message.success(`已上传 ${succeeded} 个文件`);
      modalApi.close();
      return;
    }
    // 只保留失败的文件及其名称，重试时沿用各自的幂等键
    await formApi.setFieldValue('file', failed);
    message.warning(
      `成功 ${succeeded} 个，失败 ${failed.length} 个，可直接重试失败的文件`,
    );
  },
  onOpenChange: (isOpen) => {
    if (isOpen) {
      uploadKeys.renew();
      schemes.search();
    } else {
      schemeCode.value = undefined;
      schemes.clear();
      formApi.resetForm();
      syncFiles([]);
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
  <Modal class="w-[640px]" title="上传效果图">
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
      <div v-if="files.length > 0">
        <div class="mb-2 text-sm font-medium">已选 {{ files.length }} 张</div>
        <div
          class="text-muted-foreground grid grid-cols-[56px_1fr_32px] gap-2 px-2 pb-1 text-xs"
        >
          <span>预览</span>
          <span><span class="text-destructive mr-1">*</span>资源名称</span>
          <span></span>
        </div>
        <div class="max-h-[360px] space-y-2 overflow-y-auto">
          <div
            v-for="item in files"
            :key="item.uid"
            class="border-border grid grid-cols-[56px_1fr_32px] items-center gap-2 rounded-md border p-2"
          >
            <img
              v-if="previewUrls[item.uid]"
              :src="previewUrls[item.uid]"
              :alt="item.name"
              class="bg-muted size-14 rounded object-contain"
            />
            <span v-else class="bg-muted size-14 rounded"></span>
            <div class="min-w-0">
              <Input
                v-model:value="names[item.uid]"
                :maxlength="500"
                placeholder="请输入资源名称"
              />
              <div
                class="text-muted-foreground mt-1 truncate text-xs"
                :title="item.name"
              >
                {{ item.name }}
              </div>
            </div>
            <Button
              type="text"
              size="small"
              danger
              title="移除"
              @click="removeFile(item.uid)"
            >
              <template #icon>
                <IconifyIcon icon="ant-design:delete-outlined" />
              </template>
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>
