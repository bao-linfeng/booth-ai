<script setup lang="ts">
import type { AdminRole, PermissionDefinition } from '#/api/core/roles';

import { computed, ref } from 'vue';
import { useAccess } from '@vben/access';
import { useVbenModal } from '@vben/common-ui';
import { Alert, Checkbox, message, Tag } from 'ant-design-vue';

import { getPermissionCatalogApi, getRoleApi, updateRolePermissionsApi } from '#/api/core/roles';

const emit = defineEmits<{ reload: [] }>();
const { hasAccessByCodes } = useAccess();
const role = ref<AdminRole>();
const catalog = ref<PermissionDefinition[]>([]);
const selected = ref<string[]>([]);
const editable = computed(() => !!role.value && !role.value.builtIn && hasAccessByCodes(['roles.write']));
const groups = computed(() => [...new Set(catalog.value.map(item => item.group))].map(label => ({
  label, permissions: catalog.value.filter(item => item.group === label),
})));

const [Modal, modalApi] = useVbenModal({
  title: '角色权限',
  class: 'w-[820px]',
  onConfirm: async () => {
    if (!role.value || !editable.value) return;
    modalApi.setState({ confirmLoading: true });
    try {
      await updateRolePermissionsApi(role.value.id, selected.value, role.value.revision);
      message.success('权限已保存，后续接口请求立即生效');
      emit('reload');
      modalApi.close();
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
});

function toggle(permission: PermissionDefinition, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) {
    const add = (code: string) => {
      if (next.has(code)) return;
      next.add(code);
      catalog.value.find(item => item.code === code)?.requires.forEach(add);
    };
    add(permission.code);
  } else {
    const remove = (code: string) => {
      if (!next.delete(code)) return;
      catalog.value.filter(item => item.requires.includes(code)).forEach(item => remove(item.code));
    };
    remove(permission.code);
  }
  selected.value = [...next];
}

async function open(id: number) {
  role.value = undefined;
  selected.value = [];
  catalog.value = [];
  modalApi.setState({ loading: true, showConfirmButton: false, title: '角色权限' });
  modalApi.open();
  try {
    const [detail, definitions] = await Promise.all([getRoleApi(id), getPermissionCatalogApi()]);
    role.value = detail;
    catalog.value = definitions;
    selected.value = [...detail.permissionCodes];
    modalApi.setState({ title: `${detail.name} · 权限配置`, showConfirmButton: editable.value });
  } finally {
    modalApi.setState({ loading: false });
  }
}

defineExpose({ open });
</script>

<template>
  <Modal>
    <div v-if="role" class="space-y-5">
      <Alert v-if="role.builtIn" type="info" show-icon message="内置管理员拥有全部权限，不可修改。" />
      <Alert v-else type="info" show-icon message="查看权限控制路由和查询接口，操作权限同时控制按钮和业务接口。勾选时自动补齐服务端声明的依赖权限；取消依赖会同时取消相关授权。" />
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">角色 ID：{{ role.id }}</span>
        <Tag color="blue">已选 {{ selected.length }} / {{ catalog.length }}</Tag>
      </div>
      <div class="divide-border divide-y rounded-lg border">
        <section v-for="group in groups" :key="group.label" class="grid gap-3 p-4 sm:grid-cols-[130px_1fr]">
          <h3 class="font-medium">{{ group.label }}</h3>
          <div class="flex flex-wrap gap-x-5 gap-y-3">
            <Checkbox v-for="permission in group.permissions" :key="permission.code"
              :checked="selected.includes(permission.code)" :disabled="!editable"
              @change="toggle(permission, !!$event.target.checked)">
              {{ permission.label }}
            </Checkbox>
          </div>
        </section>
      </div>
    </div>
  </Modal>
</template>
