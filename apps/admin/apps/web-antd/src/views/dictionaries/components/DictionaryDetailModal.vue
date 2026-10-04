<script setup lang="ts">
import type { VxeGridProps } from '#/adapter/vxe-table';
import type { DictionaryDetailRecord } from '#/api/core/dictionaries';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import {
  Modal as AntModal,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  InputNumber,
  message,
  Switch,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createDictionaryItemApi,
  deleteDictionaryItemApi,
  getDictionaryDetailApi,
  getDictionaryItemsApi,
  updateDictionaryItemApi,
} from '#/api/core/dictionaries';

const emit = defineEmits(['reload']);
const currentId = ref<string>('');
const detailInfo = ref<DictionaryDetailRecord | null>(null);
const isLoading = ref(false);

const gridOptions: VxeGridProps = {
  columns: [
    {
      type: 'seq' as const,
      title: '序号',
      width: 60,
      align: 'center' as const,
    },
    {
      field: 'itemValue',
      title: '字典值',
      minWidth: 120,
      editRender: {},
      slots: { default: 'default_itemValue', edit: 'edit_itemValue' },
    },
    {
      field: 'itemLabel',
      title: '字典标签',
      minWidth: 120,
      editRender: {},
      slots: { default: 'default_itemLabel', edit: 'edit_itemLabel' },
    },
    {
      field: 'description',
      title: '描述',
      minWidth: 150,
      editRender: {},
      slots: { default: 'default_description', edit: 'edit_description' },
    },
    {
      field: 'sortOrder',
      title: '排序',
      width: 80,
      align: 'center' as const,
      editRender: {},
      slots: { default: 'default_sortOrder', edit: 'edit_sortOrder' },
    },
    {
      field: 'enabled',
      title: '状态',
      width: 100,
      align: 'center' as const,
      editRender: {},
      slots: { default: 'default_enabled', edit: 'edit_enabled' },
    },
    {
      title: '操作',
      width: 120,
      slots: { default: 'action' },
      align: 'center' as const,
    },
  ],
  editConfig: {
    trigger: 'manual',
    mode: 'row',
    showStatus: true,
  },
  data: [],
  keepSource: true,
};

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions,
});

const loadData = async (id: string) => {
  try {
    isLoading.value = true;
    const res = await getDictionaryDetailApi(id);
    detailInfo.value = res;
    gridApi.setGridOptions({
      data: res.items || [],
    });
  } catch {
    // handled
  } finally {
    isLoading.value = false;
  }
};

const [Modal, modalApi] = useVbenModal({
  title: '字典详情与字典项管理',
  footer: false,
  onCancel: () => {
    modalApi.close();
    emit('reload');
  },
});

const open = async (id: string) => {
  currentId.value = id;
  modalApi.open();
  await loadData(id);
};

const handleInsert = async () => {
  const record = {
    itemValue: '',
    itemLabel: '',
    description: '',
    sortOrder: 0,
    enabled: true,
    isNew: true,
  };
  const { row: newRow } = (await gridApi.grid?.insertAt(record, -1)) || {};
  if (newRow) {
    gridApi.grid?.setEditRow(newRow);
  }
};

const handleSaveRow = async (row: any) => {
  try {
    if (!row.itemValue || !row.itemLabel) {
      message.error('字典值和字典标签不能为空');
      return;
    }

    if (row.isNew) {
      const res = await createDictionaryItemApi(currentId.value, {
        itemValue: row.itemValue,
        itemLabel: row.itemLabel,
        description: row.description,
        enabled: row.enabled,
        sortOrder: row.sortOrder,
      });
      message.success('新增字典项成功');
      Object.assign(row, res, { isNew: false });
    } else {
      await updateDictionaryItemApi(currentId.value, row.id, {
        itemLabel: row.itemLabel,
        description: row.description,
        enabled: row.enabled,
        sortOrder: row.sortOrder,
      });
      message.success('更新字典项成功');
    }
    await gridApi.grid?.clearEdit();

    // Reload items to ensure consistency
    const items = await getDictionaryItemsApi(currentId.value);
    gridApi.setGridOptions({ data: items });
  } catch {
    // handled
  }
};

const handleCancelRow = (row: any) => {
  if (row.isNew) {
    gridApi.grid?.remove(row);
  } else {
    gridApi.grid?.revertData(row);
    gridApi.grid?.clearEdit();
  }
};

const handleDeleteRow = async (row: any) => {
  if (row.isNew) {
    gridApi.grid?.remove(row);
    return;
  }

  AntModal.confirm({
    title: '确认删除',
    content: `确定要删除字典项 ${row.itemLabel} 吗？`,
    onOk: async () => {
      try {
        await deleteDictionaryItemApi(currentId.value, row.id);
        message.success('删除成功');
        gridApi.grid?.remove(row);
      } catch {
        // handled
      }
    },
  });
};

const hasActiveEditRow = (row: any) => {
  return gridApi.grid?.isActiveByRow(row);
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-200">
    <div v-if="detailInfo" class="flex flex-col gap-4">
      <div class="bg-background border-border p-4 rounded-md border">
        <Descriptions title="字典信息" :column="2" size="small">
          <DescriptionsItem label="字典名称">
            {{ detailInfo.name }}
          </DescriptionsItem>
          <DescriptionsItem label="字典类型">
            {{ detailInfo.type ?? '-' }}
          </DescriptionsItem>
          <DescriptionsItem label="字典编码">
            {{ detailInfo.code }}
          </DescriptionsItem>
          <DescriptionsItem label="状态">
            <Tag :color="detailInfo.enabled ? 'success' : 'error'">
              {{ detailInfo.enabled ? '启用' : '禁用' }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="排序">
            {{ detailInfo.sortOrder }}
          </DescriptionsItem>
          <DescriptionsItem label="描述" :span="2">
            {{ detailInfo.description || '-' }}
          </DescriptionsItem>
        </Descriptions>
      </div>

      <div class="h-96">
        <Grid>
          <template #toolbar-actions>
            <Button
              v-access:code="['dictionaries.item-create']"
              type="primary"
              @click="handleInsert"
              >新增字典项</Button
            >
          </template>

          <template #edit_itemValue="{ row }">
            <Input
              v-model:value="row.itemValue"
              :disabled="!row.isNew"
              placeholder="输入值"
            />
          </template>
          <template #default_itemValue="{ row }">
            <span>{{ row.itemValue }}</span>
          </template>

          <template #edit_itemLabel="{ row }">
            <Input v-model:value="row.itemLabel" placeholder="输入标签" />
          </template>
          <template #default_itemLabel="{ row }">
            <span>{{ row.itemLabel }}</span>
          </template>

          <template #edit_description="{ row }">
            <Input v-model:value="row.description" placeholder="输入描述" />
          </template>
          <template #default_description="{ row }">
            <span>{{ row.description }}</span>
          </template>

          <template #edit_sortOrder="{ row }">
            <InputNumber
              v-model:value="row.sortOrder"
              :min="0"
              class="w-full"
            />
          </template>
          <template #default_sortOrder="{ row }">
            <span>{{ row.sortOrder }}</span>
          </template>

          <template #edit_enabled="{ row }">
            <Switch v-model:checked="row.enabled" />
          </template>
          <template #default_enabled="{ row }">
            <Tag :color="row.enabled ? 'success' : 'error'">
              {{ row.enabled ? '启用' : '禁用' }}
            </Tag>
          </template>

          <template #action="{ row }">
            <template v-if="hasActiveEditRow(row)">
              <Button
                v-access:code="[
                  row.isNew
                    ? 'dictionaries.item-create'
                    : 'dictionaries.item-update',
                ]"
                type="link"
                size="small"
                @click="handleSaveRow(row)"
              >
                保存
              </Button>
              <Button type="link" size="small" @click="handleCancelRow(row)">
                取消
              </Button>
            </template>
            <template v-else>
              <Button
                type="link"
                size="small"
                @click="gridApi.grid?.setEditRow(row)"
                v-access:code="['dictionaries.item-update']"
              >
                编辑
              </Button>
              <Button
                danger
                type="link"
                size="small"
                @click="handleDeleteRow(row)"
                v-access:code="['dictionaries.item-delete']"
              >
                删除
              </Button>
            </template>
          </template>
        </Grid>
      </div>
    </div>
  </Modal>
</template>
