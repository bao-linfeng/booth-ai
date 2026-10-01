<script setup lang="ts">
import type { Project } from '#/api/core/projects';

import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Button, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { statusLabels } from '#/api/core/projects';

import { createFormOptions, createGridOptions } from './options';

const router = useRouter();

const formOptions = createFormOptions();
const gridOptions = createGridOptions();

const [Grid] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

function handleProcess(row: Project) {
  router.push(`/projects/${row.projectId}`);
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #source="{ row }">
        {{
          (row as Project).sourceType === 'quote_request'
            ? '报价申请'
            : '人工需求'
        }}
      </template>

      <template #budget="{ row }">
        {{
          (row as Project).request.materialBudget
            ? `${(row as Project).request.materialBudget?.currency} ${(row as Project).request.materialBudget?.amount}`
            : '待补'
        }}
      </template>

      <template #status="{ row }">
        <Tag v-if="(row as Project).status === 'won'" color="green">
          {{ statusLabels[(row as Project).status] }}
        </Tag>
        <Tag
          v-else-if="
            (row as Project).status === 'lost' ||
            (row as Project).status === 'closed'
          "
          color="red"
        >
          {{ statusLabels[(row as Project).status] }}
        </Tag>
        <Tag v-else-if="(row as Project).status === 'following'" color="blue">
          {{ statusLabels[(row as Project).status] }}
        </Tag>
        <Tag v-else-if="(row as Project).status === 'quoted'" color="orange">
          {{ statusLabels[(row as Project).status] }}
        </Tag>
        <Tag v-else color="default">
          {{ statusLabels[(row as Project).status] }}
        </Tag>
      </template>

      <template #updated="{ row }">
        {{ formatDateTime((row as Project).updatedAt) }}
      </template>

      <template #action="{ row }">
        <Button type="link" @click="handleProcess(row as Project)">
          处理项目
        </Button>
      </template>
    </Grid>
  </Page>
</template>
