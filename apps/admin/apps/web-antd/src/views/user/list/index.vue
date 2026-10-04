<script setup lang="ts">
import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import UserDetailModal from './components/UserDetailModal.vue';
import { createFormOptions, createGridOptions } from './options';

const formOptions = createFormOptions();
const gridOptions = createGridOptions();
const [Grid] = useVbenVxeGrid({ formOptions, gridOptions });

const detailModalRef = ref<InstanceType<typeof UserDetailModal>>();

const handleDetail = (row: any) => {
  detailModalRef.value?.open(row.id);
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #status="{ row }">
        <Tag :color="row.enabled ? 'success' : 'error'">
          {{ row.enabled ? '正常' : '禁用' }}
        </Tag>
      </template>
      <template #action="{ row }">
        <Button
          v-access:code="['users.detail']"
          type="link"
          size="small"
          @click="handleDetail(row)"
        >
          详情
        </Button>
      </template>
    </Grid>

    <UserDetailModal ref="detailModalRef" />
  </Page>
</template>
