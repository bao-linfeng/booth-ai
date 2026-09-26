<script setup lang="ts">
import { ref } from 'vue';
import { useVbenModal } from '@vben/common-ui';
import { useVbenForm } from '#/adapter/form';
import { message } from 'ant-design-vue';
import {
  getSchemeDetailApi,
  createSchemeApi,
  updateSchemeApi,
  getCatalogOptionsApi,
} from '#/api/core/schemes';
import type { SchemeRecord, CreateSchemeInput, UpdateSchemeInput } from '#/api/core/schemes';

const emit = defineEmits(['reload']);

const type = ref<'新增' | '编辑'>('新增');
const currentRevision = ref<number>(0);
const optionsLoaded = ref(false);

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
          lengthCm: values.lengthCm,
          widthCm: values.widthCm,
          heightCm: values.heightCm,
          areaSqm: values.areaSqm,
          openingCount: values.openingCount,
          productLine: values.productLine,
          style: values.style,
          industries: values.industries || [],
          budgetTier: values.budgetTier,
          keywords: values.keywords || [],
          openingDirections: values.openingDirections || [],
          functionalZones: values.functionalZones || [],
          keyFeatures: values.keyFeatures || [],
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
          lengthCm: values.lengthCm,
          widthCm: values.widthCm,
          heightCm: values.heightCm,
          areaSqm: values.areaSqm,
          openingCount: values.openingCount,
          productLine: values.productLine,
          style: values.style,
          industries: values.industries || [],
          budgetTier: values.budgetTier,
          keywords: values.keywords || [],
          openingDirections: values.openingDirections || [],
          functionalZones: values.functionalZones || [],
          keyFeatures: values.keyFeatures || [],
          expectedRevision: currentRevision.value,
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
    { component: 'Input', fieldName: 'code', label: '方案编号', rules: 'required', componentProps: { placeholder: '请输入' } },
    { component: 'Input', fieldName: 'name', label: '方案名称', rules: 'required', componentProps: { placeholder: '请输入' } },
    { component: 'Input', fieldName: 'source', label: '来源', componentProps: { placeholder: '请输入' } },
    { component: 'Input', fieldName: 'parentCode', label: '母方案编号', componentProps: { placeholder: '请输入' } },
    { component: 'InputNumber', fieldName: 'lengthCm', label: '长(cm)', componentProps: { min: 0, class: 'w-full' } },
    { component: 'InputNumber', fieldName: 'widthCm', label: '宽(cm)', componentProps: { min: 0, class: 'w-full' } },
    { component: 'InputNumber', fieldName: 'heightCm', label: '高(cm)', componentProps: { min: 0, class: 'w-full' } },
    {
      component: 'InputNumber',
      fieldName: 'areaSqm',
      label: '面积(m²)',
      componentProps: { min: 0, class: 'w-full', disabled: true },
      dependencies: {
        triggerFields: ['lengthCm', 'widthCm'],
        trigger: (values, formApi) => {
          const l = values.lengthCm || 0;
          const w = values.widthCm || 0;
          if (l && w) {
            formApi.setValues({ areaSqm: Number(((l * w) / 10000).toFixed(2)) });
          } else {
            formApi.setValues({ areaSqm: null });
          }
        },
      },
    },
    { component: 'Select', fieldName: 'productLine', label: '产品体系', componentProps: { placeholder: '请选择', options: [] } },
    { component: 'Select', fieldName: 'style', label: '风格', componentProps: { placeholder: '请选择', options: [] } },
    { component: 'Select', fieldName: 'industries', label: '适用行业', componentProps: { placeholder: '请选择', mode: 'multiple', options: [] } },
    { component: 'Select', fieldName: 'budgetTier', label: '预算档位', componentProps: { placeholder: '请选择', options: [] } },
    { component: 'InputNumber', fieldName: 'openingCount', label: '开口面数', componentProps: { min: 0, max: 4, class: 'w-full' } },
    { component: 'Select', fieldName: 'openingDirections', label: '开口方向', componentProps: { placeholder: '请选择', mode: 'multiple', options: [] } },
    { component: 'Select', fieldName: 'functionalZones', label: '功能分区', componentProps: { placeholder: '请输入后回车', mode: 'tags', options: [] } },
    { component: 'Select', fieldName: 'keyFeatures', label: '关键特征', componentProps: { placeholder: '请输入后回车', mode: 'tags', options: [] } },
    { component: 'Select', fieldName: 'keywords', label: '关键词', componentProps: { placeholder: '请输入后回车', mode: 'tags', options: [] } },
    { component: 'Textarea', fieldName: 'description', label: '一句话描述', formItemClass: 'col-span-2', componentProps: { placeholder: '请输入描述', rows: 2 } },
    { component: 'Textarea', fieldName: 'notes', label: '备注', formItemClass: 'col-span-2', componentProps: { placeholder: '请输入备注', rows: 3 } },
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
  if (optionsLoaded.value) return;
  try {
    const res = await getCatalogOptionsApi('style,industry,productLine,budgetTier,openingDirection');
    if (res) {
      const formatOpts = (arr: any[] | undefined) => (arr || []).map((t) => ({ label: t.label, value: t.key }));
      schemeApi.updateSchema([
        { fieldName: 'style', componentProps: { options: formatOpts(res.style) } },
        { fieldName: 'industries', componentProps: { options: formatOpts(res.industry) } },
        { fieldName: 'productLine', componentProps: { options: formatOpts(res.productLine || res.product_line) } },
        { fieldName: 'budgetTier', componentProps: { options: formatOpts(res.budgetTier || res.budget_tier) } },
        { fieldName: 'openingDirections', componentProps: { options: formatOpts(res.openingDirection || res.opening_direction) } },
      ]);
    }
    optionsLoaded.value = true;
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
    schemeApi.updateSchema([{ fieldName: 'code', componentProps: { disabled: true } }]);
    
    try {
      const detail = await getSchemeDetailApi(row.code);
      if (detail) {
        currentRevision.value = detail.revision;
        schemeApi.setValues({ ...detail });
      }
    } catch (error) {
      console.error(error);
      message.error('获取方案详情失败');
    }
  } else {
    type.value = '新增';
    modalApi.setState({ title: '新建方案' });
    schemeApi.updateSchema([{ fieldName: 'code', componentProps: { disabled: false } }]);
  }
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-200">
    <SchemeForm />
  </Modal>
</template>
