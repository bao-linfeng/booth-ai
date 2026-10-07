<script setup lang="ts">
import type { AssignmentConfig } from '#/api/core/projects';

import { computed, nextTick, onMounted, ref } from 'vue';

import { Alert, Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  assigneeStatusLabels,
  getAssigneesApi,
  getAssignmentConfigApi,
  saveAssignmentConfigApi,
} from '#/api/core/projects';

const config = ref<AssignmentConfig>();
const loading = ref(false);
const editing = ref(false);
const saving = ref(false);
const error = ref('');
const statusText = computed(() => {
  const current = config.value;
  if (!current) return '';
  if (current.status === 'active')
    return `接单正常 · 默认承接人：${current.assigneeName}`;
  return `受理已暂停 · ${current.status === 'unconfigured' ? '尚未指定默认承接人' : `${current.assigneeName}：${assigneeStatusLabels[current.status]}`}`;
});
const [Form, formApi] = useVbenForm({
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
  schema: [
    {
      component: 'Select',
      fieldName: 'defaultAssigneeAdminId',
      label: '默认承接人',
      componentProps: {
        allowClear: true,
        placeholder: '留空并保存将暂停新需求受理',
        options: [],
      },
    },
  ],
  handleSubmit: async (values: Record<string, unknown>) => {
    if (!config.value || saving.value) return;
    saving.value = true;
    error.value = '';
    try {
      config.value = await saveAssignmentConfigApi({
        defaultAssigneeAdminId:
          typeof values.defaultAssigneeAdminId === 'string'
            ? values.defaultAssigneeAdminId
            : null,
        expectedRevision: config.value.revision,
      });
      editing.value = false;
      message.success('默认接单配置已保存');
    } catch {
      error.value =
        '保存未确认，选择已保留。请重新加载配置，核对最新状态后再保存。';
    } finally {
      saving.value = false;
    }
  },
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    config.value = await getAssignmentConfigApi();
    editing.value = false;
  } catch {
    error.value = '接单配置读取失败，请重新加载。';
  } finally {
    loading.value = false;
  }
}
async function edit() {
  loading.value = true;
  error.value = '';
  try {
    const admins = await getAssigneesApi();
    editing.value = true;
    await nextTick();
    await formApi.reset();
    formApi.updateSchema([
      {
        fieldName: 'defaultAssigneeAdminId',
        componentProps: {
          allowClear: true,
          showSearch: true,
          optionFilterProp: 'label',
          placeholder: '留空并保存将暂停新需求受理',
          options: admins.map((admin) => ({
            value: admin.id,
            label: admin.name,
          })),
        },
      },
    ]);
    await formApi.setValues({
      defaultAssigneeAdminId:
        config.value?.status === 'active'
          ? config.value.defaultAssigneeAdminId
          : undefined,
    });
  } catch {
    error.value = '可承接人员读取失败，请重试。';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section
    class="mb-4 space-y-3"
    aria-label="默认接单配置"
    :aria-busy="loading || saving"
  >
    <Alert
      v-if="config"
      :type="config.status === 'active' ? 'success' : 'warning'"
      :message="statusText"
      show-icon
    >
      <template #description>
        报价申请与人工需求统一分给指定人员。未配置、人员停用或缺少项目查看 /
        跟进权限时，暂停新需求受理，不自动换人；已有项目保留负责人，由授权人员人工改派。
      </template>
    </Alert>
    <p v-else-if="loading" class="text-sm text-muted-foreground">
      正在检查默认接单配置…
    </p>
    <p v-if="error" role="alert" class="text-sm text-destructive">
      {{ error }}
    </p>
    <div class="flex flex-wrap gap-2">
      <Button :loading="loading" :disabled="saving" @click="load">
        重新加载配置
      </Button>
      <Button
        v-if="config && !editing"
        v-access:code="['projects.assign']"
        :disabled="loading"
        @click="edit"
      >
        配置默认承接人
      </Button>
    </div>
    <div v-if="editing" class="max-w-xl space-y-3">
      <Form />
      <p class="text-sm text-muted-foreground">
        仅可选择已启用且具备项目查看和跟进权限的人员。清空选择并保存将暂停受理；配置只影响新的申请。
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          type="primary"
          :loading="saving"
          :disabled="loading"
          @click="formApi.validateAndSubmit()"
        >
          保存接单配置
        </Button>
        <Button :disabled="saving" @click="editing = false">取消</Button>
      </div>
    </div>
  </section>
</template>
