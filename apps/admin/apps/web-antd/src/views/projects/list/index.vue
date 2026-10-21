<script setup lang="ts">
import type { AssignmentConfig, Project } from '#/api/core/projects';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page, useVbenModal } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Button, message, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  assigneeStatusLabels,
  getAssigneesApi,
  getAssignmentConfigApi,
  saveAssignmentConfigApi,
  statusLabels,
} from '#/api/core/projects';

import AssignModal from '../AssignModal.vue';
import { claimProject } from '../claim';
import { createFormOptions, createGridOptions } from './options';

const router = useRouter();

const formOptions = createFormOptions();
const gridOptions = createGridOptions();

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const assign = ref<InstanceType<typeof AssignModal>>();
const claiming = ref<string>();
const config = ref<AssignmentConfig>();
const saving = ref(false);

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
        placeholder: '留空时新需求进入待分配池',
        options: [],
      },
    },
  ],
  handleSubmit: async (values: Record<string, unknown>) => {
    if (!config.value || saving.value) return;
    saving.value = true;
    modalApi.setState({ confirmLoading: true });
    try {
      config.value = await saveAssignmentConfigApi({
        defaultAssigneeAdminId:
          typeof values.defaultAssigneeAdminId === 'string'
            ? values.defaultAssigneeAdminId
            : null,
        expectedRevision: config.value.revision,
      });
      message.success('默认接单配置已保存');
      modalApi.close();
    } catch {
      message.error(
        '保存未确认，选择已保留。请重新打开弹窗，核对最新状态后再保存。',
      );
    } finally {
      saving.value = false;
      modalApi.setState({ confirmLoading: false });
    }
  },
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await formApi.validateAndSubmitForm();
  },
  onCancel: () => {
    modalApi.close();
  },
});

async function openAssignmentConfig() {
  modalApi.open();
  modalApi.setState({ title: '配置默认承接人', confirmText: '保存' });
  try {
    const [configData, admins] = await Promise.all([
      getAssignmentConfigApi(),
      getAssigneesApi(),
    ]);
    config.value = configData;
    await formApi.resetForm();
    formApi.updateSchema([
      {
        fieldName: 'defaultAssigneeAdminId',
        componentProps: {
          allowClear: true,
          showSearch: true,
          optionFilterProp: 'label',
          placeholder: '留空时新需求进入待分配池',
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
    message.error('配置读取失败，请重试。');
  }
}

onMounted(async () => {
  const assignees = await getAssigneesApi();
  gridApi.formApi.updateSchema([
    {
      fieldName: 'assigneeAdminId',
      componentProps: {
        options: assignees.map((a) => ({ value: a.id, label: a.name })),
      },
    },
  ]);
});

function handleProcess(row: Project) {
  router.push(`/projects/${row.projectId}`);
}

async function handleClaim(row: Project) {
  if (claiming.value) return;
  claiming.value = row.projectId;
  try {
    if (await claimProject(row.projectId)) await gridApi.reload();
  } finally {
    claiming.value = undefined;
  }
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <Button
          type="primary"
          v-access:code="['projects.assign']"
          @click="openAssignmentConfig"
        >
          配置默认承接人
        </Button>
      </template>

      <template #assignee="{ row }">
        <Tag
          v-if="(row as Project).assigneeStatus === 'unassigned'"
          color="orange"
        >
          待分配
        </Tag>
        <span v-else>{{ (row as Project).assigneeName }}</span>
        <Tag
          v-if="
            !['active', 'unassigned'].includes((row as Project).assigneeStatus)
          "
          color="warning"
        >
          {{ assigneeStatusLabels[(row as Project).assigneeStatus]
          }}{{
            ['closed', 'lost', 'won'].includes((row as Project).status)
              ? ' · 历史负责人'
              : ' · 待人工改派'
          }}
        </Tag>
      </template>
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
        <template v-if="!(row as Project).assigneeAdminId">
          <Button
            type="link"
            size="small"
            :loading="claiming === (row as Project).projectId"
            v-access:code="['projects.follow-up']"
            @click="handleClaim(row as Project)"
          >
            分配给我
          </Button>
          <Button
            type="link"
            size="small"
            v-access:code="['projects.assign']"
            @click="assign?.open(row as Project)"
          >
            分配
          </Button>
        </template>
        <Button type="link" size="small" @click="handleProcess(row as Project)">
          进入项目
        </Button>
      </template>
    </Grid>

    <Modal class="w-[480px]">
      <Form />
      <p class="text-sm text-muted-foreground mt-2">
        仅可选择已启用且具备项目查看和跟进权限的人员。留空时新需求进入待分配池，由有分配权限的人分配或由承接人员领取；配置只影响新的申请。
      </p>
    </Modal>
    <AssignModal ref="assign" @reload="gridApi.reload()" />
  </Page>
</template>
