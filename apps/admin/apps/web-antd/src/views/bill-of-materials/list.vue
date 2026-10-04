<script setup lang="ts">
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { BomListEntry } from '#/api/core/bom';

import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { formatDate } from '@vben/utils';

import { Button, message, Modal, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteBomApi, listBomsApi } from '#/api/core/bom';

import BomImportModal from './components/BomImportModal.vue';
import BomWorkspaceModal from './index.vue';

const importModalRef = ref<InstanceType<typeof BomImportModal>>();
const workspaceModalRef = ref<InstanceType<typeof BomWorkspaceModal>>();
const route = useRoute();
const router = useRouter();
const linkedSchemeCode = computed(() =>
  typeof route.query.code === 'string' ? route.query.code : '',
);
const [Grid, gridApi] = useVbenVxeGrid<BomListEntry>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'code',
        label: '方案编号',
        componentProps: {
          disabled: !!linkedSchemeCode.value,
          placeholder: '搜索关联方案编号',
        },
      },
    ],
  },
  gridOptions: {
    height: 'auto',
    columns: [
      { field: 'schemeCode', title: '方案编号', minWidth: 160 },
      { field: 'schemeName', title: '方案名称', minWidth: 180 },
      { field: 'itemCount', title: '条目数', width: 90 },
      { field: 'revision', title: '修订版本', width: 100 },
      {
        field: 'status',
        title: '核验状态',
        width: 120,
        slots: { default: 'status' },
      },
      {
        field: 'updatedAt',
        title: '更新时间',
        minWidth: 170,
        slots: { default: 'updatedAt' },
      },
      {
        field: 'action',
        title: '操作',
        width: 290,
        fixed: 'right',
        slots: { default: 'action' },
      },
    ],
    pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: { code?: string } = {},
        ) => {
          const result = await listBomsApi({
            code:
              linkedSchemeCode.value || formValues.code?.trim() || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
          return { items: result.data, total: result.total };
        },
      },
    },
  } satisfies VxeTableGridOptions<BomListEntry>,
});

onMounted(() => {
  if (linkedSchemeCode.value) {
    gridApi.formApi.updateSchema([
      { fieldName: 'code', componentProps: { disabled: true } },
    ]);
    void gridApi.formApi.setValues({ code: linkedSchemeCode.value });
    workspaceModalRef.value?.open(linkedSchemeCode.value, 'detail');
  }
});

watch(linkedSchemeCode, (code, previousCode) => {
  if (code !== previousCode) {
    gridApi.formApi.updateSchema([
      { fieldName: 'code', componentProps: { disabled: !!code } },
    ]);
    void gridApi.formApi.setValues({ code: code || undefined });
    if (code) workspaceModalRef.value?.open(code, 'detail');
    void gridApi.reload();
  }
});

function handleDelete(row: BomListEntry) {
  if (row.status === 'verified') return;
  Modal.confirm({
    title: '确认删除清单',
    content: `确定删除方案「${row.schemeCode}」的整份清单吗？所有条目及核验记录将一并删除，无法恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteBomApi(row.schemeCode, row.revision);
        message.success('清单已删除');
        await gridApi.reload();
      } catch (error: any) {
        if (error?.response?.status === 409) {
          message.warning('清单已变化，请刷新后重试');
          await gridApi.reload();
        }
      }
    },
  });
}
</script>

<template>
  <Page auto-content-height>
    <div
      v-if="linkedSchemeCode"
      class="border-border bg-muted/50 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
    >
      <div class="text-sm">
        当前关联方案：<span class="font-medium">{{ linkedSchemeCode }}</span>
      </div>
      <Button
        type="link"
        size="small"
        @click="
          router.push(`/scheme/detail/${encodeURIComponent(linkedSchemeCode)}`)
        "
      >
        返回方案详情
      </Button>
    </div>
    <Grid>
      <template #toolbar-actions>
        <div class="flex gap-2">
          <Button
            type="primary"
            v-access:code="['bom.write']"
            @click="importModalRef?.open(linkedSchemeCode)"
          >
            导入方案清单
          </Button>
        </div>
      </template>
      <template #status="{ row }">
        <Tag
          :color="
            row.status === 'verified'
              ? 'success'
              : row.status === 'rejected'
                ? 'error'
                : 'warning'
          "
        >
          {{
            row.status === 'verified'
              ? '已核验'
              : row.status === 'rejected'
                ? '核验不通过'
                : '待核验'
          }}
        </Tag>
      </template>
      <template #updatedAt="{ row }">{{ formatDate(row.updatedAt) }}</template>
      <template #action="{ row }">
        <Button
          type="link"
          size="small"
          @click="workspaceModalRef?.open(row.schemeCode, 'detail')"
        >
          详情
        </Button>
        <Button
          type="link"
          size="small"
          :disabled="row.status === 'verified'"
          @click="workspaceModalRef?.open(row.schemeCode, 'edit')"
          v-access:code="['bom.write']"
        >
          编辑
        </Button>
        <Button
          type="link"
          size="small"
          :disabled="row.status === 'verified'"
          @click="importModalRef?.open(row.schemeCode)"
          v-access:code="['bom.write']"
        >
          替换 Excel
        </Button>
        <Button
          type="link"
          size="small"
          danger
          :disabled="row.status === 'verified'"
          @click="handleDelete(row)"
          v-access:code="['bom.write']"
        >
          删除
        </Button>
      </template>
    </Grid>

    <BomImportModal ref="importModalRef" @reload="gridApi.reload()" />
    <BomWorkspaceModal ref="workspaceModalRef" @reload="gridApi.reload()" />
  </Page>
</template>
