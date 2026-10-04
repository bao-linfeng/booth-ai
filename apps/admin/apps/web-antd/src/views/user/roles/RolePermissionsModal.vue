<script setup lang="ts">
import type { Recordable } from '@vben/types';

import type { AdminRole, PermissionDefinition } from '#/api/core/roles';

import { computed, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Tree, useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { Alert, message, Tag } from 'ant-design-vue';

import {
  getPermissionCatalogApi,
  getRoleApi,
  updateRolePermissionsApi,
} from '#/api/core/roles';
import { $t } from '#/locales';
import { accessRoutes } from '#/router/routes';

import {
  buildPermissionTree,
  diffTreeSelection,
  toTreeSelection,
} from './permission-tree';

const emit = defineEmits<{ reload: [] }>();
const { hasAccessByCodes } = useAccess();
const role = ref<AdminRole>();
const catalog = ref<PermissionDefinition[]>([]);
const selected = ref<string[]>([]);
const editable = computed(
  () => !!role.value && hasAccessByCodes(['roles.write']),
);
const tree = computed(() =>
  buildPermissionTree(accessRoutes, catalog.value, $t),
);
const treeSelection = computed(() =>
  toTreeSelection(tree.value, selected.value),
);

const [Modal, modalApi] = useVbenModal({
  title: '角色权限',
  class: 'w-[820px]',
  onConfirm: async () => {
    if (!role.value || !editable.value) return;
    modalApi.setState({ confirmLoading: true });
    try {
      await updateRolePermissionsApi(
        role.value.id,
        selected.value,
        role.value.revision,
      );
      message.success('权限已保存，后续接口请求立即生效');
      emit('reload');
      modalApi.close();
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
});

function toggleCodes(codes: string[], checked: boolean) {
  const next = new Set(selected.value);
  if (checked) {
    const add = (code: string) => {
      if (next.has(code)) return;
      next.add(code);
      catalog.value
        .find((item) => item.code === code)
        ?.requires.forEach((required) => add(required));
    };
    codes.forEach((code) => add(code));
  } else {
    const remove = (code: string) => {
      if (!next.delete(code)) return;
      catalog.value
        .filter((item) => item.requires.includes(code))
        .forEach((item) => remove(item.code));
    };
    codes.forEach((code) => remove(code));
  }
  selected.value = [...next];
}

/** Tree 只负责勾选交互；权限码才是数据源，依赖补齐与级联取消仍在 toggleCodes 中完成 */
function onTreeChange(value: unknown) {
  const { added, removed } = diffTreeSelection(
    tree.value,
    treeSelection.value,
    Array.isArray(value) ? value.map(String) : [],
  );
  if (removed.length > 0) toggleCodes(removed, false);
  if (added.length > 0) toggleCodes(added, true);
}

/** 操作节点横向排列在所属页面下方 */
const getNodeClass = (node: Recordable<any>) =>
  node.value?.type === 'action' ? 'inline-flex' : '';

async function open(id: number) {
  role.value = undefined;
  selected.value = [];
  catalog.value = [];
  modalApi.setState({
    loading: true,
    showConfirmButton: false,
    title: '角色权限',
  });
  modalApi.open();
  try {
    const [detail, definitions] = await Promise.all([
      getRoleApi(id),
      getPermissionCatalogApi(),
    ]);
    role.value = detail;
    catalog.value = definitions;
    selected.value = [...detail.permissionCodes];
    modalApi.setState({
      title: `${detail.name} · 权限配置`,
      showConfirmButton: editable.value,
    });
  } finally {
    modalApi.setState({ loading: false });
  }
}

defineExpose({ open });
</script>

<template>
  <Modal>
    <div v-if="role" class="space-y-5">
      <Alert
        type="info"
        show-icon
        message="按菜单 → 页面 → 操作分层授权，页面下列出实际按钮及业务操作；勾选菜单或页面即授予其下全部操作。“查看”控制页面入口和查询接口，其余权限同时控制按钮和业务接口。勾选时自动补齐依赖权限，取消依赖会同时取消相关授权。"
      />
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">角色 ID：{{ role.id }}</span>
        <Tag color="blue">
          已选 {{ selected.length }} / {{ catalog.length }}
        </Tag>
      </div>
      <Tree
        :tree-data="tree"
        :model-value="treeSelection"
        multiple
        bordered
        :disabled="!editable"
        :default-expanded-level="2"
        select-all-label="全选"
        :get-node-class="getNodeClass"
        value-field="id"
        label-field="title"
        @update:model-value="onTreeChange"
      >
        <template #node="{ value }">
          <IconifyIcon v-if="value.icon" :icon="value.icon" class="size-4" />
          <span :class="{ 'font-medium': value.type !== 'action' }">{{
            value.title
          }}</span>
          <Tag
            v-if="value.sharedWith?.length > 0"
            class="m-0"
            :title="`与「${value.sharedWith.join('、')}」共用同一组权限`"
          >
            共用
          </Tag>
        </template>
      </Tree>
    </div>
  </Modal>
</template>
