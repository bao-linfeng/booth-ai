<script setup lang="ts">
import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, message, Modal, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteDictionaryApi } from '#/api/core/dictionaries';

import DictionaryDetailModal from './components/DictionaryDetailModal.vue';
import DictionaryFormModal from './components/DictionaryFormModal.vue';
import { createFormOptions, createGridOptions } from './options';

const formModalRef = ref<InstanceType<typeof DictionaryFormModal>>();
const detailModalRef = ref<InstanceType<typeof DictionaryDetailModal>>();

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: createFormOptions(),
  gridOptions: createGridOptions(),
});

function handleCreate() {
  formModalRef.value?.open();
}

function handleEdit(row: any) {
  formModalRef.value?.open(row);
}

function handleDetail(id: string) {
  detailModalRef.value?.open(id);
}

function handleDelete(row: any) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除字典 ${row.name} 吗？相关字典项也会一并删除！`,
    onOk: async () => {
      try {
        await deleteDictionaryApi(row.id);
        message.success('删除成功');
        gridApi.reload();
      } catch {
        // 错误通常已被请求拦截器处理
      }
    },
  });
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="['dictionaries.write']" type="primary" @click="handleCreate">新建字典</Button>
      </template>

      <template #enabled="{ row }">
        <Tag :color="row.enabled ? 'success' : 'error'">
          {{ row.enabled ? '启用' : '禁用' }}
        </Tag>
      </template>

      <template #action="{ row }">
        <Button type="link" size="small" @click="handleDetail(row.id)">
          详情
        </Button>
        <Button v-access:code="['dictionaries.write']" type="link" size="small" @click="handleEdit(row)">编辑</Button>
        <Button v-access:code="['dictionaries.write']" danger type="link" size="small" @click="handleDelete(row)">
          删除
        </Button>
      </template>
    </Grid>

    <DictionaryFormModal ref="formModalRef" @reload="gridApi.reload()" />
    <DictionaryDetailModal ref="detailModalRef" @reload="gridApi.reload()" />
  </Page>
</template>
