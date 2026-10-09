<script setup lang="ts">
import type { BomImportResult } from '#/api/core/bom';
import type { SchemeRecord } from '#/api/core/schemes';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, Button, message, Select, Table, Upload } from 'ant-design-vue';

import {
  commitBomImportApi,
  getBomApi,
  uploadBomImportApi,
} from '#/api/core/bom';
import { getSchemeListApi } from '#/api/core/schemes';

const emit = defineEmits<{ reload: [] }>();
const schemes = ref<SchemeRecord[]>([]);
const schemeCode = ref('');
const file = ref<File | null>(null);
const preview = ref<BomImportResult | null>(null);
const busy = ref(false);
const templateHint =
  '导入表首行须包含：产品名称、型号、规格/mm、数量、计量类型、单价/¥、总价/¥、重量合计/kg、ERP编码；列顺序不限。每行填写计量类型 count / length / area，分别按件、mm、mm² 解析数量。';
const columns = [
  { title: '产品名称', dataIndex: 'productName' },
  { title: '型号', dataIndex: 'productModel' },
  { title: '规格/mm', dataIndex: 'specificationMm' },
  { title: '数量', dataIndex: 'sourceQuantity' },
  { title: '计量类型', dataIndex: 'measurementKind' },
  { title: '单价/¥', dataIndex: 'unitPrice' },
  { title: '总价/¥', dataIndex: 'totalPrice' },
  { title: '重量合计/kg', dataIndex: 'totalWeightKg' },
  { title: 'ERP编码', dataIndex: 'erpCode' },
];

async function searchSchemes(keyword: string) {
  try {
    const res = await getSchemeListApi({
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      page: 1,
      pageSize: 30,
    });
    schemes.value = res.data;
  } catch {
    message.error('获取方案失败');
  }
}

function resetPreview() {
  preview.value = null;
}

async function submit() {
  if (busy.value) return;
  if (!schemeCode.value || !file.value) {
    message.warning('请先选择方案与 Excel 文件');
    return;
  }
  busy.value = true;
  modalApi.setState({ confirmLoading: true });
  try {
    if (preview.value) {
      if (!preview.value.canCommit) {
        message.warning('文件存在错误，请重新选择文件');
        return;
      }
      await commitBomImportApi(schemeCode.value, preview.value.importId, {
        expectedRevision: preview.value.baseRevision,
      });
      message.success('清单已导入，待核验');
      emit('reload');
      modalApi.close();
    } else {
      const current = await getBomApi(schemeCode.value);
      if (current.status === 'verified') {
        message.warning('清单已核验，不能重新导入');
        return;
      }
      preview.value = await uploadBomImportApi(
        schemeCode.value,
        file.value,
        current.revision,
      );
      if (!preview.value.canCommit) message.warning('文件存在错误，请查看预览');
    }
  } catch (error: unknown) {
    const reason = (
      error as { response?: { data?: { error?: { reason?: string } } } }
    )?.response?.data?.error?.reason;
    // 文件过大已由请求拦截器提示
    if (reason === 'FILE_TOO_LARGE') return;
    if (reason === 'UNSUPPORTED_BOM_TEMPLATE') message.error(templateHint, 8);
    else if (reason === 'SCHEME_CODE_MISMATCH')
      message.error('Excel 说明页的方案编号与所选方案不一致');
    else if (reason === 'INVALID_WORKBOOK')
      message.error(
        'Excel 文件损坏、加密或包含不支持的内容，请使用有效的 XLSX 文件',
      );
    else message.error('操作失败，请检查方案、文件或清单修订');
  } finally {
    busy.value = false;
    modalApi.setState({ confirmLoading: false });
  }
}

const [Modal, modalApi] = useVbenModal({
  onConfirm: submit,
});

function open(code = '') {
  schemeCode.value = code;
  file.value = null;
  preview.value = null;
  schemes.value = [];
  if (code) searchSchemes(code);
  else searchSchemes('');
  modalApi.open();
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function beforeUpload(selected: File): boolean {
  if (selected.size > MAX_FILE_SIZE) {
    message.warning(
      `文件过大（${(selected.size / 1024 / 1024).toFixed(1)} MB），请上传 20MB 以内的 Excel 文件`,
    );
    return false;
  }
  file.value = selected;
  resetPreview();
  return false;
}

defineExpose({ open });
</script>

<template>
  <Modal
    class="w-[960px]"
    title="导入方案清单"
    :confirm-text="preview ? '确认导入' : '解析预览'"
  >
    <div class="space-y-4">
      <Alert
        show-icon
        type="info"
        message="一份 Excel 对应一个方案；选择方案后上传并预览。替换清单将使核验失效。"
        :description="templateHint"
      />
      <div class="mt-2">
        <div class="mb-1">关联方案</div>
        <Select
          v-model:value="schemeCode"
          show-search
          :filter-option="false"
          :options="
            schemes.map((scheme) => ({
              label: `${scheme.code} · ${scheme.name}`,
              value: scheme.code,
            }))
          "
          placeholder="搜索方案编号或名称"
          class="w-full"
          :disabled="!!preview || busy"
          @search="searchSchemes"
          @change="resetPreview"
        />
      </div>
      <Upload.Dragger
        :file-list="
          file ? [{ uid: 'source', name: file.name, status: 'done' }] : []
        "
        :before-upload="beforeUpload"
        :max-count="1"
        accept=".xlsx,.xlsm"
        :disabled="!!preview || busy"
        @remove="
          () => {
            file = null;
            resetPreview();
          }
        "
      >
        <p class="ant-upload-text">选择一份 XLSX/XLSM 方案清单</p>
      </Upload.Dragger>
      <template v-if="preview">
        <Alert
          :type="preview.canCommit ? 'warning' : 'error'"
          show-icon
          :message="`${preview.sourceFileName} · ${preview.items.length} 行 · 方案 ${preview.schemeCode} · 修订 ${preview.baseRevision}`"
        />
        <Button v-if="!preview.canCommit" @click="resetPreview">
          重新选择文件
        </Button>
        <div
          v-for="(error, index) in preview.errors"
          :key="`error-${index}`"
          class="text-red-600"
        >
          第 {{ error.row ?? '-' }} 行：{{ error.message }}
        </div>
        <div
          v-for="(warning, index) in preview.warnings"
          :key="`warning-${index}`"
          class="text-amber-700"
        >
          {{ warning.row ? `第 ${warning.row} 行：` : '' }}{{ warning.message }}
        </div>
        <Table
          :columns="columns"
          :data-source="preview.items"
          :pagination="{ pageSize: 10 }"
          row-key="ordinal"
          size="small"
          :scroll="{ x: 1100 }"
        />
      </template>
    </div>
  </Modal>
</template>
