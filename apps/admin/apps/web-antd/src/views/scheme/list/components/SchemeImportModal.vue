<script setup lang="ts">
import { ref } from 'vue';
import { useVbenModal } from '@vben/common-ui';
import { Upload, message, Alert, Descriptions, DescriptionsItem, Table } from 'ant-design-vue';
import { importSchemesApi, type ImportResult } from '#/api/core/schemes';

const emit = defineEmits(['reload']);

const selectedFile = ref<File | null>(null);
const importing = ref(false);
const result = ref<ImportResult | null>(null);

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    if (!selectedFile.value) {
      message.warning('请先选择文件');
      return;
    }
    importing.value = true;
    modalApi.setState({ confirmLoading: true });
    try {
      const res = await importSchemesApi(selectedFile.value);
      result.value = res;
      message.success(`导入完成：新增 ${res.created} 条，更新 ${res.updated} 条`);
      emit('reload');
      // 有错误时不关闭，让用户看到错误明细
      if (!res.errors.length) {
        modalApi.close();
      }
    } catch (e) {
      message.error('导入失败，请检查文件格式');
    } finally {
      importing.value = false;
      modalApi.setState({ confirmLoading: false });
    }
  },
  onCancel: () => {
    modalApi.close();
  },
});

const open = () => {
  selectedFile.value = null;
  result.value = null;
  modalApi.open();
  modalApi.setState({ title: '批量导入方案' });
};

const beforeUpload = (file: File) => {
  selectedFile.value = file;
  return false; // 阻止自动上传
};

const errorColumns = [
  { title: '行号', dataIndex: 'row', width: 80 },
  { title: '方案编号', dataIndex: 'code', width: 150 },
  { title: '失败原因', dataIndex: 'reason' },
];

defineExpose({ open });
</script>

<template>
  <Modal class="w-200">
    <!-- 使用说明 -->
    <Alert
      type="info"
      class="mb-4"
      message="上传说明"
      description="请上传 .xlsx 格式的方案打标模板，第 1 行为表头，从第 2 行开始为数据行。方案编号（B列）和方案名称（C列）为必填项。已存在的方案编号将被更新，不存在的将新建。"
      show-icon
    />
    
    <!-- 上传区域 -->
    <Upload.Dragger
      :before-upload="beforeUpload"
      accept=".xlsx,.xls"
      :max-count="1"
      :show-upload-list="false"
      class="mb-4"
    >
      <p class="ant-upload-drag-icon">
        <span class="icon-[ant-design--inbox-outlined] text-4xl text-blue-400" />
      </p>
      <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
      <p class="ant-upload-hint text-gray-400">仅支持 .xlsx / .xls 格式</p>
    </Upload.Dragger>
    
    <!-- 已选文件 -->
    <div v-if="selectedFile && !result" class="mb-4 flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2">
      <span class="icon-[ant-design--file-excel-outlined] text-green-500" />
      <span class="text-sm">{{ selectedFile.name }}</span>
    </div>
    
    <!-- 导入结果 -->
    <template v-if="result">
      <Descriptions bordered size="small" :column="2" class="mb-4">
        <DescriptionsItem label="共计">{{ result.total }} 行</DescriptionsItem>
        <DescriptionsItem label="跳过">{{ result.skipped }} 行</DescriptionsItem>
        <DescriptionsItem label="新增"><span class="text-green-600 font-medium">{{ result.created }} 条</span></DescriptionsItem>
        <DescriptionsItem label="更新"><span class="text-blue-600 font-medium">{{ result.updated }} 条</span></DescriptionsItem>
      </Descriptions>
      
      <Table
        v-if="result.errors.length > 0"
        :columns="errorColumns"
        :data-source="result.errors"
        size="small"
        :pagination="false"
        row-key="row"
      >
        <template #title>
          <span class="text-red-500 font-medium">错误明细（{{ result.errors.length }} 行）</span>
        </template>
      </Table>
    </template>
  </Modal>
</template>
