<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, message, Modal, Tag, Tooltip } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteSchemeApi, getSchemeOptionsApi } from '#/api/core/schemes';

import SchemeFormModal from './components/SchemeFormModal.vue';
import SchemeImportModal from './components/SchemeImportModal.vue';
import { createFormOptions, createGridOptions } from './options';

const router = useRouter();
const schemeFormModalRef = ref<InstanceType<typeof SchemeFormModal>>();
const schemeImportModalRef = ref<InstanceType<typeof SchemeImportModal>>();
const optionLabels = ref<Record<string, string>>({});

const formOptions = createFormOptions();
const gridOptions = createGridOptions();

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

async function fetchOptions() {
  try {
    const res = await getSchemeOptionsApi();
    optionLabels.value = Object.fromEntries(
      Object.values(res)
        .flat()
        .map((item) => [item.id, item.label]),
    );
    if (res) {
      gridApi.formApi.updateSchema([
        {
          fieldName: 'styleId',
          componentProps: {
            options: (res.style || []).map((opt) => ({
              label: opt.label,
              value: opt.id,
            })),
          },
        },
        {
          fieldName: 'productSystemId',
          componentProps: {
            options: (res.product_system || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
        {
          fieldName: 'industryId',
          componentProps: {
            options: (res.industry || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
        {
          fieldName: 'openingCount',
          componentProps: {
            options: (res.opening_count || []).map((o) => ({
              label: o.label,
              value: Number(o.itemValue),
            })),
          },
        },
        {
          fieldName: 'budgetTierId',
          componentProps: {
            options: (res.budget_tier || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
        {
          fieldName: 'zoneIds',
          componentProps: {
            options: (res.functional_zone || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
        {
          fieldName: 'featureIds',
          componentProps: {
            options: (res.key_feature || []).map((o) => ({
              label: o.label,
              value: o.id,
            })),
          },
        },
      ]);
    }
  } catch (error) {
    console.error('Failed to load catalog options:', error);
  }
}

function handleCreate() {
  schemeFormModalRef.value?.open();
}

function handleImport() {
  schemeImportModalRef.value?.open();
}

function handleEdit(row: any) {
  schemeFormModalRef.value?.open(row);
}

function handleReadiness(code: string) {
  router.push(`/scheme/detail/${code}?tab=readiness`);
}

function handleReview(code: string) {
  router.push(`/scheme/detail/${code}?tab=review`);
}

function handleAssets(code: string) {
  router.push(`/scheme/detail/${code}?tab=assets`);
}

function handleDetail(code: string) {
  router.push(`/scheme/detail/${code}`);
}

function handleDelete(row: any) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除方案 ${row.name || row.code} 吗？`,
    okText: '确认',
    cancelText: '取消',
    onOk: async () => {
      try {
        await deleteSchemeApi(row.code);
        message.success('删除成功');
        gridApi.reload();
      } catch (error) {
        console.error(error);
        message.error('删除失败');
      }
    },
  });
}

function onReload() {
  gridApi.reload();
}

onMounted(() => {
  fetchOptions();
});
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <div class="flex gap-2">
          <Button @click="handleImport">批量导入</Button>
          <Button type="primary" @click="handleCreate">新建方案</Button>
        </div>
      </template>

      <template #dimensions="{ row }">
        {{ row.lengthMm ?? '-' }} × {{ row.widthMm ?? '-' }} ×
        {{ row.heightMm ?? '-' }}
      </template>

      <template #openingCount="{ row }">
        {{ row.openingCount ? `${row.openingCount} 面` : '-' }}
      </template>

      <template #productSystem="{ row }">
        {{ optionLabels[row.productSystemId] ?? '-' }}
      </template>
      <template #style="{ row }">
        {{ optionLabels[row.styleId] ?? '-' }}
      </template>

      <template #publishStatus="{ row }">
        <Tag v-if="row.publishStatus === 'published'" color="green">已发布</Tag>
        <Tag v-else-if="row.publishStatus === 'unpublished'" color="orange">
          已下架
        </Tag>
        <Tag v-else color="default">草稿</Tag>
      </template>

      <template #verificationStatus="{ row }">
        <Tag v-if="row.verificationStatus === 'verified'" color="green">
          核验通过
        </Tag>
        <Tag v-else-if="row.verificationStatus === 'failed'" color="red">
          核验失败
        </Tag>
        <Tag v-else color="default">未核验</Tag>
      </template>

      <template #assetCounts="{ row }">
        <div v-if="row.assetCounts" class="flex flex-wrap gap-x-2 gap-y-1 text-xs">
          <Tooltip title="模型">
            <span class="inline-flex items-center gap-0.5">
              <span class="text-gray-400">模</span>
              <span :class="row.assetCounts.model > 0 ? 'text-blue-600 font-medium' : 'text-gray-300'">
                {{ row.assetCounts.model }}
              </span>
            </span>
          </Tooltip>
          <Tooltip title="效果图">
            <span class="inline-flex items-center gap-0.5">
              <span class="text-gray-400">效</span>
              <span :class="row.assetCounts.rendering > 0 ? 'text-blue-600 font-medium' : 'text-gray-300'">
                {{ row.assetCounts.rendering }}
              </span>
            </span>
          </Tooltip>
          <Tooltip title="蒙版">
            <span class="inline-flex items-center gap-0.5">
              <span class="text-gray-400">蒙</span>
              <span :class="row.assetCounts.mask > 0 ? 'text-blue-600 font-medium' : 'text-gray-300'">
                {{ row.assetCounts.mask }}
              </span>
            </span>
          </Tooltip>
          <Tooltip title="图纸">
            <span class="inline-flex items-center gap-0.5">
              <span class="text-gray-400">纸</span>
              <span :class="row.assetCounts.drawing > 0 ? 'text-blue-600 font-medium' : 'text-gray-300'">
                {{ row.assetCounts.drawing }}
              </span>
            </span>
          </Tooltip>
          <Tooltip title="平面素材">
            <span class="inline-flex items-center gap-0.5">
              <span class="text-gray-400">平</span>
              <span :class="row.assetCounts.artwork > 0 ? 'text-blue-600 font-medium' : 'text-gray-300'">
                {{ row.assetCounts.artwork }}
              </span>
            </span>
          </Tooltip>
        </div>
        <span v-else class="text-gray-300">—</span>
      </template>

      <template #latestReview="{ row }">
        <div v-if="row.latestReview" class="flex flex-col gap-0.5">
          <Tag
            :color="row.latestReview.decision === 'pass' ? 'green' : 'red'"
            class="w-fit"
          >
            {{
              row.latestReview.phase === 'asset_verification'
                ? '资产核验'
                : '整体审核'
            }}·{{ row.latestReview.decision === 'pass' ? '通过' : '驳回' }}
          </Tag>
          <Tooltip v-if="row.latestReview.notes" :title="row.latestReview.notes">
            <span class="max-w-[100px] truncate text-xs text-gray-400">
              {{ row.latestReview.notes }}
            </span>
          </Tooltip>
        </div>
        <span v-else class="text-gray-300">—</span>
      </template>

      <template #lastUnpublishReason="{ row }">
        <Tooltip v-if="row.lastUnpublishReason" :title="row.lastUnpublishReason">
          <span class="max-w-[140px] truncate text-xs text-orange-500 cursor-default">
            {{ row.lastUnpublishReason }}
          </span>
        </Tooltip>
        <span v-else class="text-gray-300">—</span>
      </template>

      <template #action="{ row }">
        <Tooltip title="详情">
          <Button type="link" size="small" @click="handleDetail(row.code)">
            <span class="icon-[lucide--eye]" />
          </Button>
        </Tooltip>
        <Tooltip title="编辑">
          <Button type="link" size="small" @click="handleEdit(row)">
            <span class="icon-[lucide--pencil]" />
          </Button>
        </Tooltip>
        <Tooltip title="就绪检查">
          <Button type="link" size="small" @click="handleReadiness(row.code)">
            <span class="icon-[lucide--circle-check]" />
          </Button>
        </Tooltip>
        <Tooltip title="审核">
          <Button type="link" size="small" @click="handleReview(row.code)">
            <span class="icon-[lucide--clipboard-check]" />
          </Button>
        </Tooltip>
        <Tooltip title="资产管理">
          <Button type="link" size="small" @click="handleAssets(row.code)">
            <span class="icon-[lucide--folder-open]" />
          </Button>
        </Tooltip>
        <Tooltip title="删除">
          <Button type="link" size="small" danger @click="handleDelete(row)">
            <span class="icon-[lucide--trash-2]" />
          </Button>
        </Tooltip>
      </template>
    </Grid>

    <SchemeFormModal ref="schemeFormModalRef" @reload="onReload" />
    <SchemeImportModal ref="schemeImportModalRef" @reload="onReload" />
  </Page>
</template>
