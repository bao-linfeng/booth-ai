<script setup lang="ts">
import type { UploadFile } from 'ant-design-vue';

import type { ImageSize } from '../../shared/image-spec';
import type { RenderingCandidate } from '../../shared/rendering-candidates';

import { h, markRaw, onBeforeUnmount, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { Button, Input, message, Select, Upload } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { replaceAssetFileApi, uploadAssetApi } from '#/api/core/assets';

import {
  formatImageSize,
  maskSizeError,
  readImageSize,
} from '../../shared/image-spec';
import { suggestRenderings } from '../../shared/mask-batch';
import { useRenderingCandidates } from '../../shared/rendering-candidates';
import { useSchemeOptions } from '../../shared/scheme-filter';
import { createUploadKeys } from '../../shared/upload-key';
import { defaultAssetName } from '../../shared/upload-name';

const emit = defineEmits(['reload']);

/** 每个文件各自的资源名称、像素尺寸与配对效果图 */
interface MaskRow {
  name: string;
  /** 读取到的像素尺寸；读取失败时为 null */
  size?: ImageSize | null;
  renderingId?: string;
  /** 手动选过配对效果图后不再自动推荐 */
  manual: boolean;
}

const { hasAccessByCodes } = useAccess();
const schemeCode = ref<string | undefined>(undefined);
const schemes = useSchemeOptions();
const uploadKeys = createUploadKeys();
const renderings = useRenderingCandidates(() =>
  hasAccessByCodes(['assets-masks.replace']),
);
/** 已选文件及各自的填写内容（按 uid 对应），资源名称默认取文件原始名称（不含扩展名） */
const files = ref<UploadFile[]>([]);
const rows = ref<Record<string, MaskRow>>({});
/** 本地预览图，文件移除或弹窗关闭时释放 */
const previews = new Map<string, string>();
const previewUrls = ref<Record<string, string>>({});
// 从方案详情为指定效果图补蒙版时优先配对该效果图
let preferredRenderingId: string | undefined;

/** 为尚未配对且未手动选择的文件推荐效果图 */
function autoAssign() {
  const taken = new Set<string>();
  const pending = [];
  for (const item of files.value) {
    const row = rows.value[item.uid];
    if (!row) continue;
    const size = row.size;
    if (row.renderingId) taken.add(row.renderingId);
    else if (!row.manual && size)
      pending.push({ filename: item.name, key: item.uid, size });
  }
  if (pending.length === 0) return;
  const suggested = suggestRenderings(
    pending,
    renderings.options.value,
    renderings.sizeOf,
    taken,
    preferredRenderingId,
  );
  for (const [uid, renderingId] of suggested) {
    const row = rows.value[uid];
    if (row) row.renderingId = renderingId;
  }
}

async function readSize(uid: string, file: File) {
  let size: ImageSize | null = null;
  try {
    size = await readImageSize(file);
  } catch {
    // 无法读取尺寸的文件在行内提示，提交时拦截
  }
  const row = rows.value[uid];
  if (!row) return;
  row.size = size;
  autoAssign();
}

function syncFiles(fileList: undefined | UploadFile[]) {
  files.value = fileList ?? [];
  const uids = new Set(files.value.map((item) => item.uid));
  for (const [uid, url] of previews) {
    if (!uids.has(uid)) {
      URL.revokeObjectURL(url);
      previews.delete(uid);
    }
  }
  const next: Record<string, MaskRow> = {};
  for (const item of files.value) {
    const existing = rows.value[item.uid];
    if (existing) {
      next[item.uid] = existing;
      continue;
    }
    next[item.uid] = { manual: false, name: defaultAssetName(item.name) };
    if (item.originFileObj) {
      previews.set(item.uid, URL.createObjectURL(item.originFileObj));
      readSize(item.uid, item.originFileObj);
    }
  }
  rows.value = next;
  previewUrls.value = Object.fromEntries(previews);
}

onBeforeUnmount(() => syncFiles([]));

// 切换方案后原配对全部失效，加载新方案的效果图后重新推荐
watch(schemeCode, async (code) => {
  for (const row of Object.values(rows.value)) {
    row.renderingId = undefined;
    row.manual = false;
  }
  if (!code) {
    renderings.reset();
    return;
  }
  await renderings.load(code);
  if (code === schemeCode.value) autoAssign();
});

function selectRendering(uid: string, renderingId: unknown) {
  const row = rows.value[uid];
  if (!row) return;
  row.renderingId = typeof renderingId === 'string' ? renderingId : undefined;
  row.manual = true;
}

/** 选中已配对蒙版的效果图时，改为替换该蒙版的文件 */
function replacingOf(row: MaskRow | undefined) {
  return renderings.candidateOf(row?.renderingId)?.pairedMask ?? null;
}

function rowError(uid: string): string | undefined {
  const row = rows.value[uid];
  if (!row || row.size === undefined) return undefined;
  if (row.size === null) return '无法读取图片尺寸，请确认文件是有效图片';
  if (!row.renderingId) return undefined;
  const duplicated = files.value.some(
    (item) =>
      item.uid !== uid && rows.value[item.uid]?.renderingId === row.renderingId,
  );
  if (duplicated)
    return '与其他文件选择了同一效果图，一张效果图只能配对一个蒙版';
  return maskSizeError(row.size, renderings.sizeOf(row.renderingId));
}

/** 提交前的整体校验，返回首个问题 */
function validationError(): string | undefined {
  for (const item of files.value) {
    const row = rows.value[item.uid];
    if (!row) continue;
    if (row.size === undefined) return `${item.name}：正在读取图片尺寸，请稍候`;
    const error = rowError(item.uid);
    if (error) return `${item.name}：${error}`;
    if (!row.renderingId) return `${item.name}：请选择配对效果图`;
    if (!replacingOf(row) && !row.name.trim())
      return `${item.name}：请填写资源名称`;
  }
  return undefined;
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
        // 已选文件在下方逐行展示并选择配对效果图，不再重复显示默认列表
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
              '可一次选择多张，像素尺寸需与配对效果图一致，支持 png, jpg, webp 格式（PNG 推荐）',
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
    const code = schemeCode.value;
    if (!code) {
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
    const error = validationError();
    if (error) {
      message.error(error);
      return;
    }
    const failed: UploadFile[] = [];
    modalApi.setState({ confirmLoading: true });
    try {
      for (const item of fileList) {
        const file = item.originFileObj as File | undefined;
        const row = rows.value[item.uid];
        if (!file || !row?.renderingId) continue;
        const pairedMask = replacingOf(row);
        try {
          await (pairedMask
            ? replaceAssetFileApi(
                code,
                pairedMask.id,
                file,
                pairedMask.revision,
              )
            : uploadAssetApi(code, {
                type: 'mask',
                name: row.name.trim(),
                file,
                idempotencyKey: uploadKeys.forFile(file),
                relatedAssetId: row.renderingId,
              }));
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
    // 只保留失败的文件及其填写内容，重试时沿用各自的幂等键；效果图的配对状态已变化，重新加载候选
    await formApi.setFieldValue('file', failed);
    if (succeeded > 0) await renderings.load(code);
    message.warning(
      `成功 ${succeeded} 个，失败 ${failed.length} 个，可直接重试失败的文件`,
    );
  },
  onOpenChange: (isOpen) => {
    if (isOpen) {
      uploadKeys.renew();
      schemes.search();
    } else {
      preferredRenderingId = undefined;
      schemeCode.value = undefined;
      schemes.clear();
      renderings.reset();
      formApi.resetForm();
      syncFiles([]);
    }
  },
});

function open(defaultSchemeCode?: string, defaultRenderingId?: string) {
  preferredRenderingId = defaultRenderingId;
  schemeCode.value = defaultSchemeCode;
  schemes.pin(defaultSchemeCode);
  modalApi.open();
}
defineExpose({ open });

function candidateOption(option: unknown): RenderingCandidate {
  return option as RenderingCandidate;
}
</script>

<template>
  <Modal class="w-[900px]" title="上传蒙版">
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
        <div class="mb-2 text-sm font-medium">
          已选 {{ files.length }} 张
          <span class="text-muted-foreground ml-2 text-xs font-normal">
            已按文件名与尺寸自动推荐配对效果图，请核对
          </span>
        </div>
        <div
          class="text-muted-foreground grid grid-cols-[56px_1fr_320px_32px] gap-2 px-2 pb-1 text-xs"
        >
          <span>预览</span>
          <span><span class="text-destructive mr-1">*</span>资源名称</span>
          <span><span class="text-destructive mr-1">*</span>配对效果图</span>
          <span></span>
        </div>
        <div class="max-h-[400px] space-y-2 overflow-y-auto">
          <div
            v-for="item in files"
            :key="item.uid"
            class="border-border grid grid-cols-[56px_1fr_320px_32px] items-start gap-2 rounded-md border p-2"
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
                :disabled="!!replacingOf(rows[item.uid])"
                :maxlength="500"
                placeholder="请输入资源名称"
              />
              <div
                class="text-muted-foreground mt-1 truncate text-xs"
                :title="item.name"
              >
                {{ item.name }}
                <template v-if="rows[item.uid]!.size">
                  · {{ formatImageSize(rows[item.uid]!.size!) }}
                </template>
              </div>
            </div>
            <div v-if="rows[item.uid]" class="min-w-0">
              <Select
                :value="rows[item.uid]!.renderingId"
                :options="renderings.options.value"
                :loading="renderings.loading.value"
                allow-clear
                :list-height="320"
                :not-found-content="
                  schemeCode ? '该方案暂无效果图' : '请先选择归属方案'
                "
                :placeholder="
                  schemeCode ? '请选择配对效果图' : '请先选择归属方案'
                "
                class="w-full"
                @change="(value) => selectRendering(item.uid, value)"
              >
                <template #option="option">
                  <div class="flex items-center gap-2 py-0.5">
                    <img
                      v-if="candidateOption(option).thumbnailUrl"
                      :src="candidateOption(option).thumbnailUrl!"
                      :alt="candidateOption(option).label"
                      class="border-border h-9 w-16 shrink-0 rounded border object-cover"
                    />
                    <div
                      v-else
                      class="text-muted-foreground border-border flex h-9 w-16 shrink-0 items-center justify-center rounded border border-dashed text-xs"
                    >
                      {{
                        candidateOption(option).filename ? '无预览' : '无文件'
                      }}
                    </div>
                    <div class="min-w-0 flex-1 leading-tight">
                      <div class="truncate">
                        {{ candidateOption(option).label }}
                      </div>
                      <div class="text-muted-foreground truncate text-xs">
                        {{ candidateOption(option).filename }}
                      </div>
                      <div
                        class="truncate text-xs"
                        :class="
                          candidateOption(option).pairedMask
                            ? 'text-orange-500'
                            : 'text-green-600'
                        "
                      >
                        {{ candidateOption(option).status }}
                      </div>
                    </div>
                  </div>
                </template>
              </Select>
              <div v-if="rowError(item.uid)" class="mt-1 text-xs text-red-500">
                {{ rowError(item.uid) }}
              </div>
              <div
                v-else-if="replacingOf(rows[item.uid])"
                class="mt-1 text-xs text-orange-500"
              >
                将替换蒙版「{{
                  replacingOf(rows[item.uid])!.name
                }}」的文件，不会新建蒙版
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
