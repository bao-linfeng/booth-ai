<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { message, Modal } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  getCatalogOptionsApi,
  updateCatalogOptionsByTypeApi,
} from '#/api/core/schemes';

const dictTypes = [
  { label: '风格 (style)', value: 'style' },
  { label: '行业 (industry)', value: 'industry' },
  { label: '预算档位 (budget_tier)', value: 'budget_tier' },
  { label: '产品体系 (product_line)', value: 'product_line' },
  { label: '开口方向 (opening_direction)', value: 'opening_direction' },
];

const activeTab = ref(dictTypes[0]?.value || 'style');
const loading = ref(false);
const saving = ref(false);

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    height: 'auto',
    keepSource: true,
    editConfig: {
      trigger: 'click',
      mode: 'cell',
      showStatus: true,
      beforeEditMethod({ row, column }: any) {
        if (column.field === 'key') {
          return !!row._isNew;
        }
        return true;
      },
    },
    columns: [
      {
        field: 'key',
        title: '标识符 (Key)',
        width: 200,
        editRender: {
          name: 'input',
          attrs: { placeholder: '小写字母数字下划线' },
        },
      },
      {
        field: 'label',
        title: '显示名称',
        minWidth: 150,
        editRender: { name: 'input', attrs: { placeholder: '显示名称' } },
      },
      {
        field: 'sortOrder',
        title: '排序',
        width: 100,
        editRender: { name: 'input', attrs: { type: 'number' } },
      },
      {
        field: 'enabled',
        title: '启用',
        width: 100,
        slots: { default: 'enabled' },
      },
      {
        title: '操作',
        width: 100,
        slots: { default: 'action' },
      },
    ],
  },
});

let originalDataString = '';

async function fetchDict(type: string) {
  loading.value = true;
  try {
    const res = await getCatalogOptionsApi(type);
    const data = (res?.[type] || []).map((item) => ({
      key: item.key,
      label: item.label,
      sortOrder: item.sortOrder,
      enabled: item.enabled,
    }));
    originalDataString = JSON.stringify(data);

    // Fallback if grid is not fully mounted yet
    if (gridApi.grid) {
      gridApi.grid.loadData(data);
    } else {
      gridApi.setGridOptions({ data });
    }
  } catch (error: any) {
    message.error(error.message || '获取字典数据失败');
  } finally {
    loading.value = false;
  }
}

function handleTabChange(activeKey: any) {
  if (activeKey === activeTab.value) return;

  const currentData = gridApi.grid?.getData() || [];
  const currentDataMapped = currentData.map((item: any) => ({
    key: item.key,
    label: item.label,
    sortOrder: item.sortOrder,
    enabled: item.enabled,
  }));
  const currentDataString = JSON.stringify(currentDataMapped);

  if (originalDataString && originalDataString !== currentDataString) {
    Modal.confirm({
      title: '未保存的修改',
      content: '当前字典有未保存的修改，切换将丢失这些修改，确认切换吗？',
      onOk() {
        activeTab.value = activeKey;
        fetchDict(activeKey);
      },
    });
  } else {
    activeTab.value = activeKey;
    fetchDict(activeKey);
  }
}

async function handleAdd() {
  const currentData = gridApi.grid?.getData() || [];
  const newItem = {
    key: '',
    label: '',
    sortOrder: currentData.length * 10,
    enabled: true,
    _isNew: true,
  };
  await gridApi.grid?.insertAt(newItem, -1);
}

function handleDelete(row: any) {
  if (row.key && !row._isNew) {
    Modal.confirm({
      title: '确认删除',
      content: '删除已被引用的字典项可能导致数据异常，确认删除吗？',
      onOk() {
        gridApi.grid?.remove(row);
      },
    });
  } else {
    gridApi.grid?.remove(row);
  }
}

async function handleSave() {
  const currentData = gridApi.grid?.getData() || [];

  // Validate
  for (const item of currentData) {
    if (!item.key || !item.label) {
      message.warning('标识符和显示名称不能为空');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(item.key)) {
      message.warning(
        `标识符格式错误: ${item.key}。只能包含小写字母、数字和下划线`,
      );
      return;
    }
  }

  const keys = currentData.map((i: any) => i.key);
  if (new Set(keys).size !== keys.length) {
    message.warning('标识符不能重复');
    return;
  }

  saving.value = true;
  try {
    const payload = currentData.map((item: any) => ({
      key: item.key,
      label: item.label,
      sortOrder: Number(item.sortOrder) || 0,
      enabled: !!item.enabled,
    }));
    await updateCatalogOptionsByTypeApi(activeTab.value, payload);
    message.success('保存成功');
    fetchDict(activeTab.value);
  } catch (error: any) {
    message.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  fetchDict(activeTab.value);
});
</script>

<template>
  <Page auto-content-height>
    <template #extra>
      <div class="flex gap-2">
        <a-button
          type="dashed"
          @click="handleAdd"
          class="flex items-center gap-1"
        >
          <span class="icon-[lucide--plus]"></span>
          新增字典项
        </a-button>
        <a-button type="primary" :loading="saving" @click="handleSave">
          保存修改
        </a-button>
      </div>
    </template>

    <div class="mb-4">
      <a-tabs :active-key="activeTab" @change="handleTabChange">
        <a-tab-pane
          v-for="type in dictTypes"
          :key="type.value"
          :tab="type.label"
        />
      </a-tabs>
    </div>

    <div v-loading="loading">
      <Grid>
        <template #enabled="{ row }">
          <a-switch v-model:checked="row.enabled" />
        </template>
        <template #action="{ row }">
          <a-button type="link" danger size="small" @click="handleDelete(row)">
            删除
          </a-button>
        </template>
      </Grid>
    </div>
  </Page>
</template>
