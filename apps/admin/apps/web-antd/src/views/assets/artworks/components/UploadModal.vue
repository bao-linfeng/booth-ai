<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import type { DimensionUnit } from '../artwork-metadata';

import { h, markRaw, onBeforeUnmount, ref, watch } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import {
  AutoComplete,
  Button,
  Input,
  InputNumber,
  message,
  Radio,
  Select,
  Upload,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { listSchemeAssetsApi, uploadAssetApi } from '#/api/core/assets';

import { useSchemeOptions } from '../../shared/scheme-filter';
import { createUploadKeys } from '../../shared/upload-key';
import { defaultAssetName } from '../../shared/upload-name';
import {
  buildArtworkMetadata,
  DEFAULT_DIMENSION_UNIT,
  DIMENSION_UNIT_OPTIONS,
  wallPositionOptions,
} from '../artwork-metadata';

const emit = defineEmits(['reload']);

/** 每张图各自的资源名称、墙面位置与尺寸 */
interface ArtworkRow {
  name: string;
  wallPosition?: string;
  physicalWidth?: number;
  physicalHeight?: number;
}

const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();
const uploadKeys = createUploadKeys();
const dimensionUnit = ref<DimensionUnit>(DEFAULT_DIMENSION_UNIT);
const wallOptions = ref(wallPositionOptions([]));
/** 已选文件及各自的填写内容（按 uid 对应），资源名称默认取文件原始名称（不含扩展名） */
const files = ref<UploadFile[]>([]);
const rows = ref<Record<string, ArtworkRow>>({});
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
  rows.value = Object.fromEntries(
    files.value.map((item) => [
      item.uid,
      rows.value[item.uid] ?? {
        name: defaultAssetName(item.name),
      },
    ]),
  );
}

// 墙面位置候选取该方案已有平面素材用过的位置，便于同一方案内叫法统一
watch(schemeCode, async (code) => {
  wallOptions.value = wallPositionOptions([]);
  if (!code) return;
  try {
    const assets = await listSchemeAssetsApi(code, 'artwork');
    if (schemeCode.value === code)
      wallOptions.value = wallPositionOptions(assets);
  } catch (error) {
    console.error(error);
  }
});

onBeforeUnmount(() => syncFiles([]));

function filterWallOption(input: string, option: { value: string }) {
  return option.value.includes(input.trim());
}

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
        accept: '.png,.jpg,.jpeg,.webp',
        beforeUpload: () => false,
        multiple: true,
        // 已选文件在下方逐行展示并填写参数，不再重复显示默认列表
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
              '可一次选择多张，支持图片格式（PNG 推荐）；每张图分别填写墙面位置与尺寸',
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
    if (fileList.some((item) => !rows.value[item.uid]?.name.trim())) {
      message.error('请填写资源名称');
      return;
    }
    const failed: UploadFile[] = [];
    modalApi.setState({ confirmLoading: true });
    try {
      for (const item of fileList) {
        const file = item.originFileObj as File | undefined;
        const row = rows.value[item.uid];
        if (!file || !row) continue;
        try {
          await uploadAssetApi(schemeCode.value, {
            type: 'artwork',
            name: row.name.trim(),
            file,
            idempotencyKey: uploadKeys.forFile(file),
            metadata: JSON.stringify(
              buildArtworkMetadata({
                ...row,
                dimensionUnit: dimensionUnit.value,
              }),
            ),
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
    // 只保留失败的文件及其填写内容，重试时沿用各自的幂等键
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
      dimensionUnit.value = DEFAULT_DIMENSION_UNIT;
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
  <Modal class="w-[860px]" title="上传平面素材">
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
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium">已选 {{ files.length }} 张</span>
          <span class="flex items-center gap-2 text-sm">
            尺寸单位
            <Radio.Group
              v-model:value="dimensionUnit"
              :options="DIMENSION_UNIT_OPTIONS"
              option-type="button"
              size="small"
            />
          </span>
        </div>
        <div
          class="text-muted-foreground grid grid-cols-[56px_1fr_150px_200px_32px] gap-2 px-2 pb-1 text-xs"
        >
          <span>预览</span>
          <span><span class="text-destructive mr-1">*</span>资源名称</span>
          <span>墙面位置</span>
          <span>宽 × 高（{{ dimensionUnit }}）</span>
          <span></span>
        </div>
        <div class="max-h-[360px] space-y-2 overflow-y-auto">
          <div
            v-for="item in files"
            :key="item.uid"
            class="border-border grid grid-cols-[56px_1fr_150px_200px_32px] items-center gap-2 rounded-md border p-2"
          >
            <img
              v-if="previewUrls[item.uid]"
              :src="previewUrls[item.uid]"
              :alt="item.name"
              class="bg-muted size-14 rounded object-contain"
            />
            <span v-else class="bg-muted size-14 rounded"></span>
            <div v-if="rows[item.uid]" class="min-w-0">
              <Input
                v-model:value="rows[item.uid]!.name"
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
            <AutoComplete
              v-if="rows[item.uid]"
              v-model:value="rows[item.uid]!.wallPosition"
              :options="wallOptions"
              :filter-option="filterWallOption"
              placeholder="如：正面左墙"
            />
            <div v-if="rows[item.uid]" class="flex items-center gap-1">
              <InputNumber
                v-model:value="rows[item.uid]!.physicalWidth"
                :min="0.01"
                placeholder="宽"
                class="w-full"
              />
              <span class="text-muted-foreground">×</span>
              <InputNumber
                v-model:value="rows[item.uid]!.physicalHeight"
                :min="0.01"
                placeholder="高"
                class="w-full"
              />
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
