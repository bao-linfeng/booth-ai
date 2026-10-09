<script setup lang="ts">
import type {
  ImportCommitResult,
  ImportPreviewResult,
  ImportPreviewRow,
} from '#/api/core/schemes';

import { computed, h, onBeforeUnmount, ref, watch } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { downloadFileFromBlob } from '@vben/utils';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  message,
  Radio,
  RadioGroup,
  Table,
  Tag,
  Upload,
} from 'ant-design-vue';

import {
  commitImportApi,
  downloadImportTemplateApi,
  previewImportApi,
} from '#/api/core/schemes';

import {
  formatImportSize,
  formatOpeningCount,
  formatPreviewRemaining,
  importDictionaryEntries,
  importRowNote,
  overwriteImpact,
  previewRemainingMs,
} from '../import-preview';

const emit = defineEmits(['reload']);

type Step = 'preview' | 'result' | 'upload';

const step = ref<Step>('upload');
const selectedFile = ref<File | null>(null);
const loading = ref(false);
const previewResult = ref<ImportPreviewResult | null>(null);
const commitResult = ref<ImportCommitResult | null>(null);
const duplicateStrategy = ref<'skip' | 'update'>('update');
const templateLoading = ref(false);

// 预览有效期倒计时：服务端以 expiresAt 为准，提交时返回 IMPORT_PREVIEW_EXPIRED 也视为过期
const now = ref(Date.now());
const expiredByServer = ref(false);
let clock: ReturnType<typeof setInterval> | undefined;

function stopClock() {
  if (clock !== undefined) clearInterval(clock);
  clock = undefined;
}

function startClock() {
  stopClock();
  now.value = Date.now();
  clock = setInterval(() => {
    now.value = Date.now();
  }, 15_000);
}

onBeforeUnmount(stopClock);

const remainingMs = computed(() =>
  previewResult.value
    ? previewRemainingMs(previewResult.value.expiresAt, now.value)
    : 0,
);
const impact = computed(() => overwriteImpact(previewResult.value?.rows ?? []));

const previewExpired = computed(
  () =>
    step.value === 'preview' &&
    (expiredByServer.value || remainingMs.value === 0),
);

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    if (step.value === 'upload') {
      await doPreview();
    } else if (step.value === 'preview') {
      await doCommit();
    } else {
      modalApi.close();
    }
  },
  onCancel: () => {
    modalApi.close();
  },
  onClosed: stopClock,
});

watch(previewExpired, (expired) => {
  modalApi.setState({ confirmDisabled: expired });
});

function getConfirmText() {
  if (step.value === 'upload') return '下一步：预览';
  if (step.value === 'preview') return '确认导入';
  return '完成';
}

function errorReason(error: unknown): string | undefined {
  return (error as { response?: { data?: { error?: { reason?: string } } } })
    ?.response?.data?.error?.reason;
}

async function doPreview() {
  if (!selectedFile.value) {
    message.warning('请先选择文件');
    return;
  }
  loading.value = true;
  modalApi.setState({ confirmLoading: true });
  try {
    const res = await previewImportApi(selectedFile.value);
    previewResult.value = res;
    expiredByServer.value = false;
    step.value = 'preview';
    startClock();
    modalApi.setState({
      title: '批量导入方案 — 预览确认',
      confirmText: getConfirmText(),
    });
  } catch {
    // 解析失败、表头不一致、超限、权限等错误已由请求拦截器按 reason 提示
  } finally {
    loading.value = false;
    modalApi.setState({ confirmLoading: false });
  }
}

async function doCommit() {
  if (!previewResult.value) return;
  if (previewExpired.value) {
    message.warning('预览已过期，请重新预览后再导入');
    return;
  }
  loading.value = true;
  modalApi.setState({ confirmLoading: true });
  try {
    const res = await commitImportApi(
      previewResult.value.importId,
      duplicateStrategy.value,
    );
    commitResult.value = res;
    step.value = 'result';
    stopClock();
    modalApi.setState({
      title: '批量导入方案 — 导入结果',
      confirmText: getConfirmText(),
      cancelText: '关闭',
    });
    emit('reload');
  } catch (error: unknown) {
    // 失败原因已由请求拦截器提示；预览过期时切换到重新预览入口
    if (errorReason(error) === 'IMPORT_PREVIEW_EXPIRED') {
      expiredByServer.value = true;
    }
  } finally {
    loading.value = false;
    modalApi.setState({ confirmLoading: false });
  }
}

const open = () => {
  step.value = 'upload';
  selectedFile.value = null;
  previewResult.value = null;
  commitResult.value = null;
  duplicateStrategy.value = 'update';
  expiredByServer.value = false;
  stopClock();
  modalApi.open();
  modalApi.setState({
    title: '批量导入方案',
    confirmText: getConfirmText(),
    cancelText: '取消',
  });
};

async function downloadTemplate() {
  templateLoading.value = true;
  try {
    const blob = await downloadImportTemplateApi();
    downloadFileFromBlob({ source: blob, fileName: '方案导入模板.xlsx' });
  } finally {
    templateLoading.value = false;
  }
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const beforeUpload = (file: File) => {
  if (file.size > MAX_FILE_SIZE) {
    message.warning(
      `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请上传 20MB 以内的 .xlsx 文件`,
    );
    return false;
  }
  selectedFile.value = file;
  return false;
};

function exportFailedRows() {
  if (!commitResult.value?.failed.length) return;
  const header = '工作表\t行号\t方案编号\t失败原因\n';
  const rows = commitResult.value.failed
    .map((r) => `${r.sheetName}\t${r.rowNumber}\t${r.code}\t${r.reason}`)
    .join('\n');
  const content = header + rows;
  const blob = new Blob([`\uFEFF${content}`], {
    type: 'text/tab-separated-values;charset=utf-8',
  });
  downloadFileFromBlob({ source: blob, fileName: '导入失败行.tsv' });
}

const previewColumns = [
  { title: '工作表', dataIndex: 'sheetName', width: 100, ellipsis: true },
  { title: '行号', dataIndex: 'rowNumber', width: 60 },
  { title: '方案编号', dataIndex: 'code', width: 130, ellipsis: true },
  { title: '方案名称', dataIndex: 'name', width: 150, ellipsis: true },
  {
    title: '尺寸（长×宽×高）',
    key: 'size',
    width: 150,
    ellipsis: true,
    customRender: ({ record }: { record: ImportPreviewRow }) =>
      formatImportSize(record.data),
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 86,
    customRender: ({ text }: { text: string }) => {
      const map: Record<string, { color: string; label: string }> = {
        valid: { color: 'green', label: '新增' },
        duplicate: { color: 'blue', label: '有变更' },
        unchanged: { color: 'default', label: '无需更新' },
        error: { color: 'red', label: '错误' },
      };
      const cfg = map[text] ?? { color: 'default', label: text };
      return h(Tag, { color: cfg.color }, () => cfg.label);
    },
  },
  {
    title: '说明',
    key: 'note',
    ellipsis: true,
    customRender: ({ record }: { record: ImportPreviewRow }) =>
      importRowNote(record),
  },
];

const errorColumns = [
  { title: '工作表', dataIndex: 'sheetName', width: 120, ellipsis: true },
  { title: '行号', dataIndex: 'rowNumber', width: 70 },
  { title: '方案编号', dataIndex: 'code', width: 140 },
  { title: '失败原因', dataIndex: 'reason' },
];

defineExpose({ open });
</script>

<template>
  <Modal class="w-200">
    <!-- 步骤1：上传 -->
    <template v-if="step === 'upload'">
      <Alert
        type="info"
        class="mb-4"
        message="上传说明"
        description="请使用标准模板（.xlsx）填写，每个数据工作表第 1 行为表头且列顺序须与模板一致，从第 2 行开始为数据行（名称含“说明”“选项”的工作表不导入），单次最多 10 个数据工作表、2000 行。方案编号（B列）和方案名称（C列）为必填项。确认导入后会按有效方案自动补齐开口面数、展位长宽高和面积字典。"
        show-icon
      />
      <div class="mb-3 flex justify-end">
        <Button
          type="link"
          size="small"
          :loading="templateLoading"
          @click="downloadTemplate"
        >
          <span class="icon-[ant-design--download-outlined] mr-1"></span>
          下载标准导入模板
        </Button>
      </div>
      <Upload.Dragger
        :before-upload="beforeUpload"
        accept=".xlsx"
        :max-count="1"
        :show-upload-list="false"
        class="mb-4"
      >
        <p class="ant-upload-drag-icon">
          <span
            class="icon-[ant-design--inbox-outlined] text-4xl text-blue-400"
          ></span>
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p class="ant-upload-hint text-gray-400">仅支持 .xlsx 格式</p>
      </Upload.Dragger>
      <div
        v-if="selectedFile"
        class="bg-muted/50 text-foreground flex items-center gap-2 rounded border border-border px-3 py-2"
      >
        <span
          class="icon-[ant-design--file-excel-outlined] text-green-500"
        ></span>
        <span class="text-sm">{{ selectedFile.name }}</span>
      </div>
    </template>

    <!-- 步骤2：预览 -->
    <template v-else-if="step === 'preview' && previewResult">
      <Alert v-if="previewExpired" type="warning" class="mb-4" show-icon>
        <template #message>
          预览已过期，文件内容需重新校验后才能导入。
          <Button
            type="link"
            size="small"
            :loading="loading"
            @click="doPreview"
          >
            重新预览
          </Button>
        </template>
      </Alert>
      <div v-else class="text-muted-foreground mb-2 text-right text-xs">
        预览有效期 1 小时，{{ formatPreviewRemaining(remainingMs) }}
      </div>

      <Descriptions bordered size="small" :column="5" class="mb-4">
        <DescriptionsItem label="总行数">
          {{ previewResult.summary.total }}
        </DescriptionsItem>
        <DescriptionsItem label="新增">
          <span class="text-green-600 font-medium">{{
            previewResult.summary.valid
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="有变更">
          <span class="text-blue-600 font-medium">{{
            previewResult.summary.duplicate
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="无需更新">
          {{ previewResult.summary.unchanged }}
        </DescriptionsItem>
        <DescriptionsItem label="错误">
          <span class="text-red-500 font-medium">{{
            previewResult.summary.error
          }}</span>
        </DescriptionsItem>
      </Descriptions>

      <div
        v-if="previewResult.summary.duplicate > 0"
        class="bg-muted/50 text-foreground mb-4 rounded border border-border px-4 py-3"
      >
        <div class="mb-2 text-sm font-medium">
          已存在且有变更的方案（{{ impact.updates }} 个）处理策略：
        </div>
        <RadioGroup v-model:value="duplicateStrategy">
          <Radio value="update">覆盖更新（用文件内容更新已有方案）</Radio>
          <Radio value="skip">跳过（保留已有方案不变）</Radio>
        </RadioGroup>
        <Alert
          v-if="duplicateStrategy === 'update'"
          :type="
            impact.unpublish > 0 || impact.clearing > 0 ? 'warning' : 'info'
          "
          class="mt-3"
          show-icon
        >
          <template #message>
            <div>
              将覆盖 {{ impact.updates }} 个已有方案，仅写入有变化的字段。
            </div>
            <div v-if="impact.unpublish > 0">
              其中
              {{
                impact.unpublish
              }}
              个已发布方案将退回草稿，需重新核验并通过整体审核后才能再次发布（仅改备注的不受影响）。
            </div>
            <div v-if="impact.clearing > 0">
              {{
                impact.clearing
              }}
              个方案的部分字段在文件中为空，覆盖后原值将被清空，具体见“说明”列。
            </div>
          </template>
        </Alert>
      </div>

      <Table
        :columns="previewColumns"
        :data-source="previewResult.rows"
        size="small"
        :pagination="{ pageSize: 10, showSizeChanger: false }"
        row-key="rowId"
        :row-expandable="(record: ImportPreviewRow) => !!record.data"
        :scroll="{ y: 320 }"
      >
        <template #expandedRowRender="{ record }">
          <Descriptions size="small" :column="3">
            <DescriptionsItem label="母方案">
              {{ record.data?.parentCode ?? '—' }}
            </DescriptionsItem>
            <DescriptionsItem label="尺寸">
              {{ formatImportSize(record.data) }}
            </DescriptionsItem>
            <DescriptionsItem label="开口">
              {{ formatOpeningCount(record.data?.openingCount) }}
            </DescriptionsItem>
            <DescriptionsItem
              v-for="entry in importDictionaryEntries(record)"
              :key="entry.label"
              :label="entry.label"
            >
              <Tag v-for="value in entry.values" :key="value">{{ value }}</Tag>
            </DescriptionsItem>
          </Descriptions>
        </template>
      </Table>
    </template>

    <!-- 步骤3：结果 -->
    <template v-else-if="step === 'result' && commitResult">
      <Descriptions bordered size="small" :column="3" class="mb-4">
        <DescriptionsItem label="新增">
          <span class="text-green-600 font-medium">{{ commitResult.created }} 条</span>
        </DescriptionsItem>
        <DescriptionsItem label="更新">
          <span class="text-blue-600 font-medium">{{ commitResult.updated }} 条</span>
        </DescriptionsItem>
        <DescriptionsItem label="无需更新">
          {{ commitResult.unchanged ?? 0 }} 条
        </DescriptionsItem>
        <DescriptionsItem label="失败">
          <span class="text-red-500 font-medium">{{ commitResult.failed.length }} 条</span>
        </DescriptionsItem>
        <DescriptionsItem label="新增字典项">
          <span class="text-purple-600 font-medium">{{ commitResult.dictionaryItemsCreated }} 条</span>
        </DescriptionsItem>
      </Descriptions>
      <Table
        v-if="commitResult.failed.length > 0"
        :columns="errorColumns"
        :data-source="commitResult.failed"
        size="small"
        :pagination="false"
        row-key="rowId"
      >
        <template #title>
          <div class="flex items-center justify-between">
            <span class="text-red-500 font-medium">失败明细</span>
            <Button size="small" @click="exportFailedRows">
              <span class="icon-[ant-design--download-outlined] mr-1"></span>
              导出失败行
            </Button>
          </div>
        </template>
      </Table>
    </template>
  </Modal>
</template>
