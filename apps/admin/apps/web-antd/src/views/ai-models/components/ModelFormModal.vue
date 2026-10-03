<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';
import type {
  AiModelRecord,
  AiProtocol,
  AiProviderRecord,
  DiscoveredModel,
  ModelKind,
  ModelParams,
  ParamField,
} from '#/api/core/ai-models';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, Button, Checkbox, message, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createAiModelApi,
  discoverAiProviderModelsApi,
  KIND_LABELS,
  PURPOSE_LABELS,
  updateAiModelApi,
} from '#/api/core/ai-models';

import { discoveryErrorMessage } from '../discovery-error';

type FormValues = Record<string, unknown> & {
  enabled: boolean;
  kind: ModelKind;
  model: string;
  name: string;
};

const props = defineProps<{ protocols: AiProtocol[] }>();
const emit = defineEmits<{ reload: [] }>();

const PARAM_PREFIX = 'param__';
const provider = ref<AiProviderRecord | null>(null);
const editing = ref<AiModelRecord | null>(null);
const kind = ref<ModelKind>('image');
const discovered = ref<DiscoveredModel[]>([]);
const discovering = ref(false);
const discoveryError = ref<null | string>(null);
const showAllKinds = ref(false);

const protocol = computed(() =>
  props.protocols.find((item) => item.id === provider.value?.protocol),
);
const capability = computed(() =>
  protocol.value?.kinds.find((item) => item.kind === kind.value),
);
const modelOptions = computed(() =>
  discovered.value
    .filter(
      (item) => showAllKinds.value || !item.kind || item.kind === kind.value,
    )
    .map((item) => ({
      value: item.id,
      label: item.name ? `${item.id}（${item.name}）` : item.id,
    })),
);

function paramSchema(field: ParamField): VbenFormSchema<FormValues> {
  const base = {
    fieldName: `${PARAM_PREFIX}${field.key}`,
    label: field.label,
    help: field.description,
    defaultValue: field.default,
  };
  return field.type === 'number'
    ? {
        ...base,
        component: 'InputNumber',
        componentProps: {
          min: field.min,
          max: field.max,
          step: field.step ?? 1,
        },
        rules: 'required',
      }
    : {
        ...base,
        component: 'Select',
        componentProps: { options: field.options },
        rules: 'selectRequired',
      };
}

function buildSchema(): VbenFormSchema<FormValues>[] {
  return [
    {
      component: 'RadioGroup',
      fieldName: 'kind',
      label: '模型类型',
      rules: 'selectRequired',
      componentProps: {
        disabled: Boolean(editing.value),
        options: (protocol.value?.kinds ?? []).map((item) => ({
          label: KIND_LABELS[item.kind],
          value: item.kind,
        })),
      },
      help: '决定可分配的用途与参数；创建后不可修改',
    },
    {
      component: 'AutoComplete',
      fieldName: 'model',
      label: '模型 ID',
      rules: 'required',
      componentProps: {
        options: modelOptions.value,
        placeholder: '从拉取的列表中选择，或直接输入',
        filterOption: (input: string, option: { value: string }) =>
          option.value.toLowerCase().includes(input.toLowerCase()),
      },
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: '显示名称',
      rules: 'required',
      componentProps: { maxlength: 60, placeholder: '后台与客户端展示的名称' },
    },
    {
      component: 'Switch',
      fieldName: 'enabled',
      label: '启用',
      defaultValue: true,
    },
    ...(capability.value?.params ?? []).map((field) => paramSchema(field)),
  ];
}

const [Form, formApi] = useVbenForm<FormValues>({
  showDefaultActions: false,
  commonConfig: { componentProps: { class: 'w-full' } },
  schema: [],
  handleValuesChange: (values, fieldsChanged) => {
    if (fieldsChanged.includes('kind') && values.kind !== kind.value) {
      kind.value = values.kind as ModelKind;
      refreshSchema();
    }
    if (fieldsChanged.includes('model') && !values.name) {
      const match = discovered.value.find((item) => item.id === values.model);
      if (match) formApi.setFieldValue('name', match.name ?? match.id);
    }
  },
  handleSubmit: async (values) => {
    modalApi.setState({ confirmLoading: true });
    try {
      const params: ModelParams = Object.fromEntries(
        (capability.value?.params ?? []).map((field) => [
          field.key,
          values[`${PARAM_PREFIX}${field.key}`] as number | string,
        ]),
      );
      const input = {
        name: values.name.trim(),
        model: values.model.trim(),
        params,
        enabled: values.enabled,
      };
      const target = editing.value;
      await (target
        ? updateAiModelApi(target.id, {
            ...input,
            expectedRevision: target.revision,
          })
        : createAiModelApi({
            ...input,
            kind: kind.value,
            providerId: provider.value?.id ?? '',
          }));
      message.success('模型已保存');
      emit('reload');
      modalApi.close();
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await formApi.validateAndSubmitForm();
  },
});

function refreshSchema() {
  formApi.setState({ schema: buildSchema() });
  formApi.setValues(
    Object.fromEntries(
      (capability.value?.params ?? []).map((field) => [
        `${PARAM_PREFIX}${field.key}`,
        field.default,
      ]),
    ),
  );
}

function refreshModelOptions() {
  formApi.updateSchema([
    { fieldName: 'model', componentProps: { options: modelOptions.value } },
  ]);
}

async function discover() {
  if (!provider.value) return;
  discovering.value = true;
  discoveryError.value = null;
  try {
    discovered.value = await discoverAiProviderModelsApi(provider.value.id);
    refreshModelOptions();
    message.success(`获取到 ${discovered.value.length} 个模型`);
  } catch (error) {
    discoveryError.value = discoveryErrorMessage(error);
  } finally {
    discovering.value = false;
  }
}

function toggleAllKinds() {
  showAllKinds.value = !showAllKinds.value;
  refreshModelOptions();
}

async function open(target: AiProviderRecord, model?: AiModelRecord) {
  provider.value = target;
  editing.value = model ?? null;
  showAllKinds.value = false;
  discoveryError.value = null;
  discovered.value = protocolOf(target.protocol)?.suggestedModels ?? [];
  kind.value =
    model?.kind ?? protocolOf(target.protocol)?.kinds[0]?.kind ?? 'image';
  modalApi.setState({
    title: model ? `编辑模型 · ${model.name}` : `为「${target.name}」添加模型`,
  });
  modalApi.open();
  await formApi.resetForm();
  refreshSchema();
  await formApi.setValues({
    kind: kind.value,
    model: model?.model ?? '',
    name: model?.name ?? '',
    enabled: model?.enabled ?? true,
    ...Object.fromEntries(
      Object.entries(model?.params ?? {}).map(([key, value]) => [
        `${PARAM_PREFIX}${key}`,
        value,
      ]),
    ),
  });
}

function protocolOf(id: string) {
  return props.protocols.find((item) => item.id === id);
}

defineExpose({ open });
</script>

<template>
  <Modal class="w-[600px]">
    <div
      class="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-2"
    >
      <Button
        size="small"
        :loading="discovering"
        :disabled="!provider?.credentialConfigured"
        @click="discover"
      >
        {{ protocol?.discoverable ? '从供应商拉取模型列表' : '载入推荐模型' }}
      </Button>
      <Checkbox :checked="showAllKinds" @change="toggleAllKinds">
        显示其他类型
      </Checkbox>
      <span
        v-if="!provider?.credentialConfigured"
        class="text-xs text-destructive"
      >
        供应商未配置 API Key，无法拉取
      </span>
      <span v-else class="text-xs text-muted-foreground">
        已载入 {{ discovered.length }} 个，按类型筛选后可选
        {{ modelOptions.length }} 个
      </span>
    </div>
    <Alert
      v-if="discoveryError"
      class="mb-4"
      type="error"
      show-icon
      :message="discoveryError"
      description="也可按供应商文档手动填写模型 ID；手动填写不会验证该模型是否可调用。"
    />
    <Form />
    <div
      v-if="capability"
      class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      可分配用途：
      <Tag v-for="purpose in capability.purposes" :key="purpose">
        {{ PURPOSE_LABELS[purpose] }}
      </Tag>
      <span v-if="editing">·
        保存修改会使该模型尚未提交的报价失效，进行中的任务不再调用旧配置</span>
    </div>
  </Modal>
</template>
