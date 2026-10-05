<script setup lang="ts">
import type { VxeGridProps } from '#/adapter/vxe-table';
import type { DictionaryDetailRecord, DictionaryItemRecord } from '#/api/core/dictionaries';

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
import { useVbenForm } from '#/adapter/form';
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
type EditableItem = DictionaryItemRecord & { isNew?: boolean };
const languageItem = ref<DictionaryItemRecord | null>(null);

function parseLanguageLines(text: string): { locale: string; text: string }[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf('|');
    const locale = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (separator < 1 || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(locale) || !value) {
      throw new Error('每行请填写“语言代码 | 文本”，例如 en | Modern minimalist');
    }
    return { locale, text: value };
  });
}

const [LanguageForm, languageFormApi] = useVbenForm({
  showDefaultActions: false,
  schema: [
    { component: 'Textarea', fieldName: 'labels', label: '多语言名称', componentProps: {
      rows: 4, placeholder: '每行一个名称，例如：\nen | Modern minimalist\nja | モダン・ミニマル',
    } },
    { component: 'Textarea', fieldName: 'aliases', label: '搜索别名', componentProps: {
      rows: 6, placeholder: '每行一个别名，同一语言可填写多行，例如：\nen | modern minimalism\nja | ミニマルスタイル',
    } },
  ],
  handleSubmit: async (values: Record<string, unknown>) => {
    if (!languageItem.value) return;
    try {
      const labels = parseLanguageLines(String(values.labels ?? ''));
      if (new Set(labels.map(item => item.locale.toLowerCase())).size !== labels.length) throw new Error('同一语言只能设置一个展示名称');
      languageModalApi.setState({ confirmLoading: true });
      await updateDictionaryItemApi(currentId.value, languageItem.value.id, {
        labels: Object.fromEntries(labels.map(item => [item.locale, item.text])),
        aliases: parseLanguageLines(String(values.aliases ?? '')),
      });
      message.success('多语言名称与别名已保存');
      languageModalApi.close();
      await loadData(currentId.value);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      languageModalApi.setState({ confirmLoading: false });
    }
  },
});
const [LanguageModal, languageModalApi] = useVbenModal({
  title: '多语言名称与搜索别名',
  onConfirm: () => languageFormApi.validateAndSubmitForm(),
});

function editLanguages(row: DictionaryItemRecord) {
  languageItem.value = row;
  languageFormApi.resetForm();
  languageFormApi.setValues({
    labels: Object.entries(row.labels).map(([locale, text]) => `${locale} | ${text}`).join('\n'),
    aliases: row.aliases.map(alias => `${alias.locale} | ${alias.text}`).join('\n'),
  });
  languageModalApi.setState({ title: `${row.itemLabel} · 多语言与别名` });
  languageModalApi.open();
}

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
      field: 'labels',
      title: '多语言 / 别名',
      minWidth: 160,
      slots: { default: 'languages' },
    },
    {
      title: '操作',
      width: 190,
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
    labels: {},
    aliases: [],
    isNew: true,
  };
  const { row: newRow } = (await gridApi.grid?.insertAt(record, -1)) || {};
  if (newRow) {
    gridApi.grid?.setEditRow(newRow);
  }
};

const handleSaveRow = async (row: EditableItem) => {
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

const handleCancelRow = (row: EditableItem) => {
  if (row.isNew) {
    gridApi.grid?.remove(row);
  } else {
    gridApi.grid?.revertData(row);
    gridApi.grid?.clearEdit();
  }
};

const handleDeleteRow = async (row: EditableItem) => {
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

const hasActiveEditRow = (row: EditableItem) => {
  return gridApi.grid?.isActiveByRow(row);
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-300">
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

          <template #languages="{ row }">
            <div class="flex flex-wrap gap-1">
              <Tag v-for="locale in Object.keys(row.labels)" :key="locale">{{ locale }}</Tag>
              <span class="text-muted-foreground text-xs">{{ row.aliases.length }} 个别名</span>
            </div>
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
                v-access:code="['dictionaries.item-update']"
                type="link"
                size="small"
                @click="editLanguages(row)"
              >语言</Button>
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
  <LanguageModal class="w-160">
    <p class="text-muted-foreground mb-4 text-sm">中文标签作为默认名称。切换语言只改变展示；名称和别名均映射到同一个字典 ID。缺少翻译时显示默认名称。</p>
    <LanguageForm />
  </LanguageModal>
</template>
