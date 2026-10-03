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
import { formatDateTime } from '@vben/utils';

import { Alert, Button, Checkbox, message, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createAiModelApi,
  KIND_LABELS,
  PURPOSE_LABELS,
  refreshAiProviderCatalogApi,
  updateAiModelApi,
} from '#/api/core/ai-models';

import { discoveryErrorMessage } from '../discovery-error';

type FormValues = Record<string, unknown> & {
  enabled: boolean;
  kind: ModelKind;
  model: string;
};

const props = defineProps<{ protocols: AiProtocol[] }>();
const emit = defineEmits<{ reload: [] }>();

const PARAM_PREFIX = 'param__';
const provider = ref<AiProviderRecord | null>(null);
const editing = ref<AiModelRecord | null>(null);
const kind = ref<ModelKind>('image');
const catalog = ref<DiscoveredModel[]>([]);
const catalogRefreshedAt = ref<null | string>(null);
const refreshing = ref(false);
const discoveryError = ref<null | string>(null);
const showAllKinds = ref(false);

const protocol = computed(() =>
  props.protocols.find((item) => item.id === provider.value?.protocol),
);
const capability = computed(() =>
  protocol.value?.kinds.find((item) => item.kind === kind.value),
);
// Models already added under this provider are hidden; each provider holds a model id once.
const addedModels = computed(
  () =>
    new Set(
      (provider.value?.models ?? [])
        .filter((item) => item.id !== editing.value?.id)
        .map((item) => item.model),
    ),
);
const modelOptions = computed(() =>
  catalog.value
    .filter(
      (item) =>
        !addedModels.value.has(item.id) &&
        (showAllKinds.value || !item.kind || item.kind === kind.value),
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
        placeholder: '从模型目录中选择，或直接输入',
        filterOption: (input: string, option: { value: string }) =>
          option.value.toLowerCase().includes(input.toLowerCase()),
      },
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

async function refreshCatalog() {
  if (!provider.value) return;
  refreshing.value = true;
  discoveryError.value = null;
  try {
    const result = await refreshAiProviderCatalogApi(provider.value.id);
    catalog.value = result.models;
    catalogRefreshedAt.value = result.refreshedAt;
    refreshModelOptions();
    message.success(`模型目录已更新，共 ${result.models.length} 个`);
    emit('reload');
  } catch (error) {
    discoveryError.value = discoveryErrorMessage(error);
  } finally {
    refreshing.value = false;
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
  catalog.value = target.catalogRefreshedAt
    ? target.modelCatalog
    : (protocolOf(target.protocol)?.suggestedModels ?? []);
  catalogRefreshedAt.value = target.catalogRefreshedAt;
  kind.value =
    model?.kind ?? protocolOf(target.protocol)?.kinds[0]?.kind ?? 'image';
  modalApi.setState({
    title: model ? `编辑模型 · ${model.model}` : `为「${target.name}」添加模型`,
  });
  modalApi.open();
  await formApi.resetForm();
  refreshSchema();
  await formApi.setValues({
    kind: kind.value,
    model: model?.model ?? '',
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
        :loading="refreshing"
        :disabled="!provider?.credentialConfigured"
        @click="refreshCatalog"
      >
        {{ protocol?.discoverable ? '刷新模型目录' : '载入推荐模型' }}
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
        <template v-if="catalogRefreshedAt">
          目录 {{ catalog.length }} 个（{{ formatDateTime(catalogRefreshedAt) }}
          刷新），筛选后可选 {{ modelOptions.length }} 个
        </template>
        <template v-else>尚未刷新模型目录，可直接输入模型 ID</template>
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
