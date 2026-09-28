<script setup lang="ts">
import type { SchemeRecord } from '#/api/core/schemes';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { getSchemeOptionsApi, getSchemeDetailApi } from '#/api/core/schemes';

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
      fieldName: 'lengthMm',
      label: '长(mm)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'widthMm',
      label: '宽(mm)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'heightMm',
      label: '高(mm)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'areaM2',
      label: '面积(m²)',
      componentProps: { disabled: true, class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'productSystemId',
      label: '产品体系',
      componentProps: { disabled: true, options: [] },
    },
    {
      component: 'Select',
      fieldName: 'styleId',
      label: '风格',
      componentProps: { disabled: true, options: [] },
    },
    {
      component: 'Select',
      fieldName: 'industryIds',
      label: '适用行业',
      componentProps: { disabled: true, mode: 'multiple', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'budgetTierId',
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
      fieldName: 'openSides',
      label: '开口方向',
      componentProps: { disabled: true, mode: 'multiple', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'zoneIds',
      label: '功能分区',
      componentProps: { disabled: true, mode: 'multiple', options: [] },
    },
    {
      component: 'Select',
      fieldName: 'featureIds',
      label: '关键特征',
      componentProps: { disabled: true, mode: 'multiple', options: [] },
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
    const res = await getSchemeOptionsApi();
    if (res) {
      const formatOpts = (arr: { id: string; label: string }[] | undefined) =>
        (arr || []).map((t) => ({ label: t.label, value: t.id }));
      schemeApi.updateSchema([
        {
          fieldName: 'styleId',
          componentProps: { options: formatOpts(res.style) },
        },
        {
          fieldName: 'industryIds',
          componentProps: { options: formatOpts(res.industry) },
        },
        {
          fieldName: 'productSystemId',
          componentProps: {
            options: formatOpts(res.product_system),
          },
        },
        {
          fieldName: 'budgetTierId',
          componentProps: {
            options: formatOpts(res.budget_tier),
          },
        },
        {
          fieldName: 'openSides',
          componentProps: {
            options: ['front','right','back','left'].map((value) => ({ value, label: ({front:'正面',right:'右侧',back:'背面',left:'左侧'} as Record<string,string>)[value] })),
          },
        },
      ]);
      schemeApi.updateSchema([
        { fieldName: 'zoneIds', componentProps: { options: formatOpts(res.functional_zone) } },
        { fieldName: 'featureIds', componentProps: { options: formatOpts(res.key_feature) } },
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
      schemeApi.setValues({ ...detail, areaM2: detail.areaM2 === null ? null : Number(detail.areaM2) });
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
