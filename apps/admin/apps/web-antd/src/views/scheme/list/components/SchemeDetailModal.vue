<script setup lang="ts">
import type { SchemeRecord } from '#/api/core/schemes';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { getCatalogOptionsApi, getSchemeDetailApi } from '#/api/core/schemes';

const optionsLoaded = ref(false);
const detailData = ref<null | SchemeRecord>(null);

const [SchemeForm, schemeApi] = useVbenForm({
  handleSubmit: async () => {},
  schema: [
    {
      component: 'Input',
      fieldName: 'code',
      label: '方案编号',
      componentProps: { disabled: true },
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: '方案名称',
      componentProps: { disabled: true },
    },
    {
      component: 'Input',
      fieldName: 'source',
      label: '来源',
      componentProps: { disabled: true },
    },
    {
      component: 'Input',
      fieldName: 'parentCode',
      label: '母方案编号',
      componentProps: { disabled: true },
    },
    {
      component: 'InputNumber',
      fieldName: 'lengthCm',
      label: '长(cm)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'widthCm',
      label: '宽(cm)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'heightCm',
      label: '高(cm)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'areaSqm',
      label: '面积(m²)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'productLine',
      label: '产品体系',
      componentProps: { disabled: true, options: [] },
    },
    {
      component: 'Select',
      fieldName: 'style',
      label: '风格',
      componentProps: { disabled: true, options: [] },
    },
    {
      component: 'Select',
      fieldName: 'industries',
      label: '适用行业',
      componentProps: { disabled: true, mode: 'multiple', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'budgetTier',
      label: '预算档位',
      componentProps: { disabled: true, options: [] },
    },
    {
      component: 'InputNumber',
      fieldName: 'openingCount',
      label: '开口面数',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'openingDirections',
      label: '开口方向',
      componentProps: { disabled: true, mode: 'multiple', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'functionalZones',
      label: '功能分区',
      componentProps: { disabled: true, mode: 'tags', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'keyFeatures',
      label: '关键特征',
      componentProps: { disabled: true, mode: 'tags', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'keywords',
      label: '关键词',
      componentProps: { disabled: true, mode: 'tags', options: [] },
    },
    {
      component: 'Textarea',
      fieldName: 'description',
      label: '一句话描述',
      formItemClass: 'col-span-2',
      componentProps: { disabled: true, rows: 2 },
    },
    {
      component: 'Textarea',
      fieldName: 'notes',
      label: '备注',
      formItemClass: 'col-span-2',
      componentProps: { disabled: true, rows: 3 },
    },
  ],
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2',
});

const [Modal, modalApi] = useVbenModal({
  footer: false,
});

async function loadOptions() {
  if (optionsLoaded.value) return;
  try {
    const res = await getCatalogOptionsApi(
      'style,industry,productLine,budgetTier,openingDirection',
    );
    if (res) {
      const formatOpts = (arr: any[] | undefined) =>
        (arr || []).map((t) => ({ label: t.label, value: t.key }));
      schemeApi.updateSchema([
        {
          fieldName: 'style',
          componentProps: { options: formatOpts(res.style) },
        },
        {
          fieldName: 'industries',
          componentProps: { options: formatOpts(res.industry) },
        },
        {
          fieldName: 'productLine',
          componentProps: {
            options: formatOpts(res.productLine || res.product_line),
          },
        },
        {
          fieldName: 'budgetTier',
          componentProps: {
            options: formatOpts(res.budgetTier || res.budget_tier),
          },
        },
        {
          fieldName: 'openingDirections',
          componentProps: {
            options: formatOpts(res.openingDirection || res.opening_direction),
          },
        },
      ]);
    }
    optionsLoaded.value = true;
  } catch (error) {
    console.error('Failed to load catalogs', error);
  }
}

const open = async (code: string) => {
  modalApi.open();
  modalApi.setState({ title: '方案详情' });
  schemeApi.resetForm();
  detailData.value = null;
  await loadOptions();

  try {
    const detail = await getSchemeDetailApi(code);
    if (detail) {
      detailData.value = detail;
      schemeApi.setValues({ ...detail });
    }
  } catch (error) {
    console.error(error);
    message.error('获取方案详情失败');
  }
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-200">
    <div v-if="detailData" class="mb-6 flex gap-8 px-4">
      <div>
        <span class="mr-2 text-gray-500">发布状态：</span>
        <Tag v-if="detailData.publishStatus === 'published'" color="green">
          已发布
        </Tag>
        <Tag
          v-else-if="detailData.publishStatus === 'unpublished'"
          color="orange"
        >
          未发布
        </Tag>
        <Tag v-else>草稿</Tag>
      </div>
      <div>
        <span class="mr-2 text-gray-500">核验状态：</span>
        <Tag v-if="detailData.verificationStatus === 'verified'" color="green">
          核验通过
        </Tag>
        <Tag v-else-if="detailData.verificationStatus === 'failed'" color="red">
          核验失败
        </Tag>
        <Tag v-else>未核验</Tag>
      </div>
    </div>
    <SchemeForm />
  </Modal>
</template>
