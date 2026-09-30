<script setup lang="ts">
import type {
  ImportCommitResult,
  ImportPreviewResult,
} from '#/api/core/schemes';

import { h, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { downloadFileFromBlob, downloadFileFromUrl } from '@vben/utils';

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

import { commitImportApi, previewImportApi } from '#/api/core/schemes';

const emit = defineEmits(['reload']);

type Step = 'preview' | 'result' | 'upload';

const step = ref<Step>('upload');
const selectedFile = ref<File | null>(null);
const loading = ref(false);
const previewResult = ref<ImportPreviewResult | null>(null);
const commitResult = ref<ImportCommitResult | null>(null);
const duplicateStrategy = ref<'skip' | 'update'>('update');

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
});

function getConfirmText() {
  if (step.value === 'upload') return '下一步：预览';
  if (step.value === 'preview') return '确认导入';
  return '完成';
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
    step.value = 'preview';
    modalApi.setState({
      title: '批量导入方案 — 预览确认',
      confirmText: getConfirmText(),
    });
  } catch {
    message.error('文件解析失败，请检查格式');
  } finally {
    loading.value = false;
    modalApi.setState({ confirmLoading: false });
  }
}

async function doCommit() {
  if (!previewResult.value) return;
  loading.value = true;
  modalApi.setState({ confirmLoading: true });
  try {
    const res = await commitImportApi(
      previewResult.value.importId,
      duplicateStrategy.value,
    );
    commitResult.value = res;
    step.value = 'result';
    modalApi.setState({
      title: '批量导入方案 — 导入结果',
      confirmText: getConfirmText(),
      cancelText: '关闭',
    });
    emit('reload');
  } catch {
    message.error('提交失败，请重试');
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
  modalApi.open();
  modalApi.setState({
    title: '批量导入方案',
    confirmText: getConfirmText(),
    cancelText: '取消',
  });
};

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
  const header = '行号\t方案编号\t失败原因\n';
  const rows = commitResult.value.failed
    .map((r) => `${r.rowNumber}\t${r.code}\t${r.reason}`)
    .join('\n');
  const content = header + rows;
  const blob = new Blob([`\uFEFF${content}`], {
    type: 'text/tab-separated-values;charset=utf-8',
  });
  downloadFileFromBlob({ source: blob, fileName: '导入失败行.tsv' });
}

const previewColumns = [
  { title: '行号', dataIndex: 'rowNumber', width: 70 },
  { title: '方案编号', dataIndex: 'code', width: 140 },
  { title: '方案名称', dataIndex: 'name', width: 180 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    customRender: ({ text }: { text: string }) => {
      const map: Record<string, { color: string; label: string }> = {
        valid: { color: 'green', label: '新增' },
        duplicate: { color: 'blue', label: '重复' },
        error: { color: 'red', label: '错误' },
      };
      const cfg = map[text] ?? { color: 'default', label: text };
      return h(Tag, { color: cfg.color }, () => cfg.label);
    },
  },
  { title: '原因', dataIndex: 'reason', ellipsis: true },
];

const errorColumns = [
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
        description="请上传 .xlsx 格式的方案打标模板，第 1 行为表头，从第 2 行开始为数据行。方案编号（B列）和方案名称（C列）为必填项。确认导入后会按有效方案自动补齐开口面数、展位长宽高和面积字典。"
        show-icon
      />
      <div class="mb-3 flex justify-end">
        <Button
          type="link"
          size="small"
          @click="
            downloadFileFromUrl({
              source: '/templates/scheme-import-template.xlsx',
            })
          "
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
      <Descriptions bordered size="small" :column="4" class="mb-4">
        <DescriptionsItem label="总行数">
          {{ previewResult.summary.total }}
        </DescriptionsItem>
        <DescriptionsItem label="新增">
          <span class="text-green-600 font-medium">{{
            previewResult.summary.valid
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="重复">
          <span class="text-blue-600 font-medium">{{
            previewResult.summary.duplicate
          }}</span>
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
        <div class="mb-2 text-sm font-medium">重复编号处理策略：</div>
        <RadioGroup v-model:value="duplicateStrategy">
          <Radio value="update">覆盖更新（用文件内容更新已有方案）</Radio>
          <Radio value="skip">跳过（保留已有方案不变）</Radio>
        </RadioGroup>
      </div>

      <Table
        :columns="previewColumns"
        :data-source="previewResult.rows"
        size="small"
        :pagination="{ pageSize: 10, showSizeChanger: false }"
        row-key="rowNumber"
        :scroll="{ y: 320 }"
      />
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
        row-key="rowNumber"
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
