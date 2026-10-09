<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import type { RenderingCandidate } from '../../shared/rendering-candidates';

import { computed, h, markRaw, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { Alert, message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { replaceAssetFileApi, uploadAssetApi } from '#/api/core/assets';

import { maskSizeError, readImageSize } from '../../shared/image-spec';
import { useRenderingCandidates } from '../../shared/rendering-candidates';
import { useSchemeOptions } from '../../shared/scheme-filter';
import { createUploadKey } from '../../shared/upload-key';

const emit = defineEmits(['reload']);

const { hasAccessByCodes } = useAccess();
const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();
const uploadKey = createUploadKey();
const renderings = useRenderingCandidates(() =>
  hasAccessByCodes(['assets-masks.replace']),
);
const relatedAssetId = ref<string | undefined>(undefined);
/** 选中已被占用的效果图时，改为替换该效果图现有蒙版的文件 */
const replacing = computed(
  () => renderings.candidateOf(relatedAssetId.value)?.pairedMask ?? null,
);

/** 返回文件不满足配对效果图尺寸时的原因；尚未选择效果图时不校验。 */
async function fileSizeError(
  file: Blob,
  renderingId: string | undefined,
): Promise<string | undefined> {
  const size = await readImageSize(file);
  if (!renderingId) return undefined;
  return maskSizeError(size, renderings.sizeOf(renderingId));
}

watch(schemeCode, (code) => {
  formApi.setFieldValue('relatedAssetId', undefined);
  if (code) renderings.load(code);
  else renderings.reset();
});

function renderCandidate(option: RenderingCandidate) {
  const thumbnail = option.thumbnailUrl
    ? h('img', {
        alt: option.label,
        class: 'h-9 w-16 shrink-0 rounded border border-border object-cover',
        src: option.thumbnailUrl,
      })
    : h(
        'div',
        {
          class:
            'text-muted-foreground flex h-9 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border text-xs',
        },
        option.filename ? '无预览' : '无文件',
      );
  const detail = [
    option.filename,
    option.sizeText,
    `排序 ${option.sortOrder + 1}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return h('div', { class: 'flex items-center gap-2 py-0.5' }, [
    thumbnail,
    h('div', { class: 'min-w-0 flex-1 leading-tight' }, [
      h('div', { class: 'truncate' }, option.label),
      h('div', { class: 'text-muted-foreground truncate text-xs' }, detail),
      h(
        'div',
        {
          class: option.pairedMask
            ? 'truncate text-xs text-orange-500'
            : 'truncate text-xs text-green-600',
        },
        option.status,
      ),
    ]),
  ]);
}

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  handleValuesChange: (values) => {
    relatedAssetId.value = values.relatedAssetId;
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
        options: renderings.options.value,
        loading: renderings.loading.value,
        placeholder: '请先选择归属方案，再选择配对效果图',
        allowClear: true,
        listHeight: 320,
        notFoundContent: schemeCode.value
          ? '该方案暂无效果图'
          : '请先选择归属方案',
      }),
      renderComponentContent: () => ({
        option: (option: RenderingCandidate) => renderCandidate(option),
      }),
    },
    {
      component: 'Input' as const,
      fieldName: 'name',
      label: '资源名称',
      rules: 'required',
      componentProps: { placeholder: '请输入资源名称' },
      dependencies: {
        triggerFields: ['relatedAssetId'],
        // 替换现有蒙版文件时沿用原蒙版名称
        if: (values) =>
          !renderings.candidateOf(values.relatedAssetId)?.pairedMask,
      },
    },
    {
      component: markRaw(Upload.Dragger),
      fieldName: 'file',
      modelPropName: 'fileList',
      label: '上传文件',
      rules: 'selectRequired',
      componentProps: {
        accept: '.png,.jpg,.jpeg,.webp',
        beforeUpload: async (
          file: File,
        ): Promise<boolean | typeof Upload.LIST_IGNORE> => {
          try {
            const { relatedAssetId } = await formApi.getValues();
            const error = await fileSizeError(file, relatedAssetId);
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
              '像素尺寸需与配对效果图一致，支持 png, jpg, webp 格式（PNG 推荐）',
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
    // 选文件后可能又改了配对效果图，提交前按最终配对再校验一次
    try {
      const error = await fileSizeError(file, values.relatedAssetId);
      if (error) {
        message.error(error);
        return;
      }
    } catch (error) {
      message.error((error as Error).message);
      return;
    }

    const pairedMask = renderings.candidateOf(
      values.relatedAssetId,
    )?.pairedMask;
    try {
      modalApi.setState({ confirmLoading: true });
      if (pairedMask) {
        await replaceAssetFileApi(
          schemeCode.value,
          pairedMask.id,
          file as File,
          pairedMask.revision,
        );
        message.success(`已替换蒙版「${pairedMask.name}」的文件`);
      } else {
        await uploadAssetApi(schemeCode.value, {
          type: 'mask',
          name: values.name,
          file: file as File,
          idempotencyKey: uploadKey.forFile(file as File),
          relatedAssetId: values.relatedAssetId,
        });
        message.success('上传成功');
      }
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
      uploadKey.renew();
      schemes.search();
    } else {
      schemeCode.value = undefined;
      relatedAssetId.value = undefined;
      schemes.clear();
      renderings.reset();
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
  <Modal class="w-[560px]" title="上传蒙版">
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
      <Alert
        v-if="replacing"
        type="warning"
        show-icon
        :message="`该效果图已配对蒙版「${replacing.name}」，确认后将替换该蒙版的文件，不会新建蒙版；方案需重新审核后才能发布。`"
      />
    </div>
  </Modal>
</template>
