<script setup lang="ts">
import type { AiProtocol, AiProviderRecord } from '#/api/core/ai-models';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createAiProviderApi,
  discoverAiProviderModelsApi,
  probeAiProviderApi,
  updateAiProviderApi,
} from '#/api/core/ai-models';

type FormValues = {
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
  name: string;
  protocol: string;
};

const props = defineProps<{ protocols: AiProtocol[] }>();
const emit = defineEmits<{ reload: [] }>();

const editing = ref<AiProviderRecord | null>(null);
const testing = ref(false);
const testResult = ref<null | string>(null);

function protocolOf(id?: string) {
  return props.protocols.find((item) => item.id === id);
}

function normalizedBaseUrl(values: FormValues) {
  return (
    values.baseUrl?.trim() ||
    protocolOf(values.protocol)?.defaultBaseUrl ||
    ''
  ).replace(/\/+$/, '');
}

const [Form, formApi] = useVbenForm<FormValues>({
  showDefaultActions: false,
  commonConfig: { componentProps: { class: 'w-full' } },
  schema: [
    {
      component: 'Input',
      fieldName: 'name',
      label: '名称',
      rules: 'required',
      componentProps: {
        maxlength: 60,
        placeholder: '例如：OpenAI、DeepSeek、公司中转',
      },
    },
    {
      component: 'Select',
      fieldName: 'protocol',
      label: '接口协议',
      rules: 'selectRequired',
      componentProps: { options: [] },
      help: '决定可接入的模型类型与参数；创建后不可修改',
    },
    {
      component: 'Input',
      fieldName: 'baseUrl',
      label: 'Base URL',
      componentProps: { placeholder: '留空使用官方地址' },
      help: '仅支持 https 公网地址，用于中转服务或兼容 OpenAI 的其他厂商',
      dependencies: {
        triggerFields: ['protocol'],
        componentProps: (values) => ({
          placeholder: `留空使用官方地址 ${protocolOf(values.protocol)?.defaultBaseUrl ?? ''}`,
        }),
      },
    },
    {
      component: 'InputPassword',
      fieldName: 'apiKey',
      label: 'API Key',
      componentProps: {
        autocomplete: 'new-password',
        placeholder: '保存后不再显示',
      },
    },
    {
      component: 'Switch',
      fieldName: 'enabled',
      label: '启用',
      defaultValue: true,
      help: '停用后，该供应商下的所有模型都不会被调用',
    },
  ],
  handleSubmit: async (values) => {
    modalApi.setState({ confirmLoading: true });
    try {
      const input = {
        name: values.name.trim(),
        baseUrl: values.baseUrl?.trim() || null,
        enabled: values.enabled,
        ...(values.apiKey?.trim() ? { apiKey: values.apiKey.trim() } : {}),
      };
      const target = editing.value;
      await (target
        ? updateAiProviderApi(target.id, {
            ...input,
            expectedRevision: target.revision,
          })
        : createAiProviderApi({ ...input, protocol: values.protocol }));
      message.success('供应商已保存');
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

async function testConnection() {
  const values = await formApi.getValues();
  const apiKey = values.apiKey?.trim();
  if (!apiKey && !editing.value?.credentialConfigured) {
    message.warning('请先填写 API Key');
    return;
  }
  testing.value = true;
  testResult.value = null;
  try {
    let models;
    if (apiKey) {
      models = await probeAiProviderApi({
        protocol: values.protocol,
        baseUrl: values.baseUrl?.trim() || null,
        apiKey,
      });
    } else if (
      editing.value &&
      normalizedBaseUrl(values) === editing.value.baseUrl
    ) {
      // 未填新密钥且地址未改时用已保存的配置测试；已保存的密钥不会被发往表单中的新地址
      models = await discoverAiProviderModelsApi(editing.value.id);
    } else {
      message.warning('修改了 Base URL，请同时填写 API Key 再测试');
      return;
    }
    testResult.value = protocolOf(values.protocol)?.discoverable
      ? `连接成功，供应商返回 ${models.length} 个模型`
      : `该协议不提供模型列表，可选推荐模型 ${models.length} 个`;
  } finally {
    testing.value = false;
  }
}

function open(provider?: AiProviderRecord) {
  editing.value = provider ?? null;
  testResult.value = null;
  modalApi.setState({
    title: provider ? `编辑供应商 · ${provider.name}` : '新建供应商',
  });
  modalApi.open();
  formApi.resetForm();
  formApi.updateSchema([
    {
      fieldName: 'protocol',
      componentProps: {
        disabled: Boolean(provider),
        options: props.protocols.map((item) => ({
          label: `${item.label}（${item.description}）`,
          value: item.id,
        })),
      },
    },
    {
      fieldName: 'apiKey',
      rules: provider?.credentialConfigured ? undefined : 'required',
      componentProps: {
        placeholder: provider?.credentialConfigured
          ? '已配置，留空则保留原密钥'
          : '保存后不再显示',
      },
    },
  ]);
  formApi.setValues({
    name: provider?.name ?? '',
    protocol: provider?.protocol ?? props.protocols[0]?.id,
    baseUrl:
      provider &&
      provider.baseUrl !== protocolOf(provider.protocol)?.defaultBaseUrl
        ? provider.baseUrl
        : '',
    apiKey: '',
    enabled: provider?.enabled ?? true,
  });
}

defineExpose({ open });
</script>

<template>
  <Modal class="w-[560px]">
    <Form />
    <div class="flex items-center gap-3 px-1">
      <Button :loading="testing" @click="testConnection">测试连接</Button>
      <span class="text-xs text-muted-foreground">用当前填写的地址与密钥拉取模型列表，不会保存</span>
    </div>
    <Alert
      v-if="testResult"
      class="mt-3"
      type="success"
      show-icon
      :message="testResult"
    />
  </Modal>
</template>
