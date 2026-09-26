<script setup lang="ts">
import { Page } from '@vben/common-ui';
import { Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { createFormOptions, createGridOptions } from './options';

const formOptions = createFormOptions();
const gridOptions = createGridOptions();
const [Grid] = useVbenVxeGrid({ formOptions, gridOptions });
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #status="{ row }">
        <Tag :color="row.enabled ? 'success' : 'error'">
          {{ row.enabled ? '正常' : '禁用' }}
        </Tag>
      </template>
    </Grid>
  </Page>
</template>
