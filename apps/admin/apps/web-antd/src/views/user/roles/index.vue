<script setup lang="ts">
import type { AdminRole } from '#/api/core/roles';

import { ref } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';

import { Button, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { getRolesApi } from '#/api/core/roles';

import RolePermissionsModal from './RolePermissionsModal.vue';

const modal = ref<InstanceType<typeof RolePermissionsModal>>();
const { hasAccessByCodes } = useAccess();
const [Grid, gridApi] = useVbenVxeGrid<AdminRole>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'name',
        label: '角色名称',
        componentProps: { placeholder: '搜索角色名称', allowClear: true },
      },
    ],
    showCollapseButton: false,
  },
  gridOptions: {
    height: 'auto',
    rowConfig: { keyField: 'id' },
    toolbarConfig: { refresh: true, zoom: true },
    columns: [
      { field: 'id', title: '角色 ID', width: 120 },
      { field: 'name', title: '角色名称', minWidth: 240 },
      {
        field: 'permissionCodes',
        title: '本系统授权',
        minWidth: 180,
        slots: { default: 'permissions' },
      },
      {
        title: '操作',
        width: 160,
        fixed: 'right',
        slots: { default: 'actions' },
      },
    ],
    pagerConfig: { enabled: false },
    proxyConfig: {
      ajax: {
        query: async (_params: unknown, values: { name?: string } = {}) => {
          const roles = await getRolesApi();
          const name = values.name?.trim().toLowerCase() ?? '';
          const items = roles.filter((role) =>
            role.name.toLowerCase().includes(name),
          );
          return { items, total: items.length };
        },
      },
    },
  },
});
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <span class="text-muted-foreground text-sm">
          角色来自灵通用户系统，权限由本系统独立配置
        </span>
      </template>
      <template #permissions="{ row }">
        <Tag v-if="row.permissionCodes.length" color="success">
          已授权 {{ row.permissionCodes.length }} 项
        </Tag>
        <Tag v-else>未授权</Tag>
      </template>
      <template #actions="{ row }">
        <Button type="link" @click="modal?.open(row.id)">
          {{ hasAccessByCodes(['roles.write']) ? '配置权限' : '查看权限' }}
        </Button>
      </template>
    </Grid>
    <RolePermissionsModal ref="modal" @reload="gridApi.reload()" />
  </Page>
</template>
