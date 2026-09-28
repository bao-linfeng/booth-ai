<script setup lang="ts">
import type {
  CreateSchemeInput,
  SchemeRecord,
  UpdateSchemeInput,
} from '#/api/core/schemes';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createSchemeApi,
  getSchemeDetailApi,
  getSchemeOptionsApi,
  updateSchemeApi,
} from '#/api/core/schemes';

const emit = defineEmits(['reload']);

const type = ref<'新增' | '编辑'>('新增');
const currentRevision = ref<number>(0);

const [SchemeForm, schemeApi] = useVbenForm({
  handleSubmit: async (values: Record<string, any>) => {
    try {
      modalApi.setState({ confirmLoading: true });
      if (type.value === '新增') {
        const payload: CreateSchemeInput = {
          code: values.code,
          name: values.name,
          source: values.source,
          parentCode: values.parentCode,
          description: values.description,
          notes: values.notes,
          lengthMm: values.lengthMm,
          widthMm: values.widthMm,
          heightMm: values.heightMm,
          areaM2: values.areaM2,
          openingCount: values.openingCount,
          productSystemId: values.productSystemId,
          styleId: values.styleId,
          industryIds: values.industryIds || [],
          budgetTierId: values.budgetTierId,
          keywords: values.keywords || [],
          zoneIds: values.zoneIds || [],
          featureIds: values.featureIds || [],
        };
        await createSchemeApi(payload);
        message.success('新增成功');
      } else {
        const payload: UpdateSchemeInput = {
          name: values.name,
          source: values.source,
          parentCode: values.parentCode,
          description: values.description,
          notes: values.notes,
          lengthMm: values.lengthMm,
          widthMm: values.widthMm,
          heightMm: values.heightMm,
          areaM2: values.areaM2,
          openingCount: values.openingCount,
          productSystemId: values.productSystemId,
          styleId: values.styleId,
          industryIds: values.industryIds || [],
          budgetTierId: values.budgetTierId,
          keywords: values.keywords || [],
          zoneIds: values.zoneIds || [],
          featureIds: values.featureIds || [],
          editRevision: currentRevision.value,
        };
        await updateSchemeApi(values.code, payload);
        message.success('编辑成功');
      }
      emit('reload');
      modalApi.close();
    } catch (error) {
      console.error(error);
      message.error(type.value === '新增' ? '新增失败' : '编辑失败');
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Input',
      fieldName: 'code',
      label: '方案编号',
      rules: 'required',
      componentProps: { placeholder: '请输入' },
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: '方案名称',
      rules: 'required',
      componentProps: { placeholder: '请输入' },
    },
    {
      component: 'Input',
      fieldName: 'source',
      label: '来源',
      componentProps: { placeholder: '请输入' },
    },
    {
      component: 'Input',
      fieldName: 'parentCode',
      label: '母方案编号',
      componentProps: { placeholder: '请输入' },
    },
    {
      component: 'InputNumber',
      fieldName: 'lengthMm',
      label: '长(mm)',
      componentProps: { min: 1, precision: 0, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'widthMm',
      label: '宽(mm)',
      componentProps: { min: 1, precision: 0, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'heightMm',
      label: '高(mm)',
      componentProps: { min: 1, precision: 0, class: 'w-full' },
    },
    {
      component: 'InputNumber',
      fieldName: 'areaM2',
      label: '面积(m²)',
      componentProps: { min: 0, class: 'w-full', disabled: true },
      dependencies: {
        triggerFields: ['lengthMm', 'widthMm'],
        trigger: (values, formApi) => {
          const l = values.lengthMm || 0;
          const w = values.widthMm || 0;
          if (l && w) {
            formApi.setValues({
              areaM2: Number(((l * w) / 1_000_000).toFixed(6)),
            });
          } else {
            formApi.setValues({ areaM2: null });
          }
        },
      },
    },
    {
      component: 'Select',
      fieldName: 'productSystemId',
      label: '产品体系',
      componentProps: { placeholder: '请选择', options: [], class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'styleId',
      label: '风格',
      componentProps: { placeholder: '请选择', options: [], class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'industryIds',
      label: '适用行业',
      componentProps: {
        placeholder: '请选择',
        mode: 'multiple',
        options: [],
        class: 'w-full',
      },
    },
    {
      component: 'Select',
      fieldName: 'budgetTierId',
      label: '预算档位',
      componentProps: { placeholder: '请选择', options: [], class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'openingCount',
      label: '开口面数',
      componentProps: { placeholder: '请选择', options: [], class: 'w-full' },
    },
    {
      component: 'Select',
      fieldName: 'zoneIds',
      label: '功能分区',
      componentProps: {
        placeholder: '请选择',
        mode: 'multiple',
        options: [],
        class: 'w-full',
      },
    },
    {
      component: 'Select',
      fieldName: 'featureIds',
      label: '关键特征',
      componentProps: {
        placeholder: '请选择',
        mode: 'multiple',
        options: [],
        class: 'w-full',
      },
    },
    {
      component: 'Select',
      fieldName: 'keywords',
      label: '关键词',
      componentProps: {
        placeholder: '请输入后回车',
        mode: 'tags',
        options: [],
        class: 'w-full',
      },
    },
    {
      component: 'Textarea',
      fieldName: 'description',
      label: '一句话描述',
      formItemClass: 'col-span-2',
      componentProps: { placeholder: '请输入描述', rows: 2 },
    },
    {
      component: 'Textarea',
      fieldName: 'notes',
      label: '备注',
      formItemClass: 'col-span-2',
      componentProps: { placeholder: '请输入备注', rows: 3 },
    },
  ],
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2',
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await schemeApi.validateAndSubmitForm();
  },
  onCancel: () => {
    modalApi.close();
  },
});

async function loadOptions() {
  try {
    const res = await getSchemeOptionsApi();
    if (res) {
      const formatOpts = (
        arr: undefined | { id: string; label: string; itemValue: string }[],
      ) => (arr || []).map((t) => ({ label: t.label, value: t.id }));
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
          componentProps: { options: formatOpts(res.product_system) },
        },
        {
          fieldName: 'budgetTierId',
          componentProps: { options: formatOpts(res.budget_tier) },
        },
        {
          fieldName: 'openingCount',
          componentProps: {
            options: (res.opening_count || []).map((t) => ({
              label: t.label,
              value: Number(t.itemValue),
            })),
          },
        },
        {
          fieldName: 'zoneIds',
          componentProps: { options: formatOpts(res.functional_zone) },
        },
        {
          fieldName: 'featureIds',
          componentProps: { options: formatOpts(res.key_feature) },
        },
      ]);
    }
  } catch (error) {
    console.error('Failed to load catalogs', error);
  }
}

const open = async (row?: SchemeRecord) => {
  modalApi.open();
  schemeApi.resetForm();
  await loadOptions();

  if (row) {
    type.value = '编辑';
    modalApi.setState({ title: '编辑方案' });
    schemeApi.updateSchema([
      { fieldName: 'code', componentProps: { disabled: true } },
    ]);

    try {
      const detail = await getSchemeDetailApi(row.code);
      if (detail) {
        currentRevision.value = detail.editRevision;
        schemeApi.setValues({
          ...detail,
          areaM2: detail.areaM2 === null ? null : Number(detail.areaM2),
        });
      }
    } catch (error) {
      console.error(error);
      message.error('获取方案详情失败');
    }
  } else {
    type.value = '新增';
    modalApi.setState({ title: '新建方案' });
    schemeApi.updateSchema([
      { fieldName: 'code', componentProps: { disabled: false } },
    ]);
  }
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-200">
    <SchemeForm />
  </Modal>
</template>
