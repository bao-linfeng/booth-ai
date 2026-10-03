<script setup lang="ts">
import type { AiProtocol, AiProviderRecord } from '#/api/core/ai-models';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Alert, Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createAiProviderApi,
  probeAiProviderApi,
  refreshAiProviderCatalogApi,
  updateAiProviderApi,
} from '#/api/core/ai-models';

import { discoveryErrorMessage } from '../discovery-error';

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
const testError = ref<null | string>(null);

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
      let id: string;
      if (target) {
        await updateAiProviderApi(target.id, {
          ...input,
          expectedRevision: target.revision,
        });
        id = target.id;
      } else {
        ({ id } = await createAiProviderApi({
          ...input,
          protocol: values.protocol,
        }));
      }
      message.success('供应商已保存');
      // 新供应商、换了密钥或地址时目录需要重新拉取（改地址时服务端已清空旧目录）
      const endpointChanged =
        !target ||
        Boolean(input.apiKey) ||
        normalizedBaseUrl(values) !== target.baseUrl;
      if (endpointChanged && (input.apiKey || target?.credentialConfigured)) {
        await fillCatalog(id);
      }
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

/** A new provider gets its first catalog right away; failures leave it for「刷新模型」. */
async function fillCatalog(id: string) {
  try {
    const { models } = await refreshAiProviderCatalogApi(id);
    message.success(`已保存 ${models.length} 个模型到模型目录`);
  } catch (error) {
    message.warning(
      `模型目录未能获取：${discoveryErrorMessage(error)}，可稍后点击「刷新模型」重试`,
    );
  }
}

async function testConnection() {
  const values = await formApi.getValues();
  const apiKey = values.apiKey?.trim();
  if (!apiKey && !editing.value?.credentialConfigured) {
    message.warning('请先填写 API Key');
    return;
  }
  testing.value = true;
  testResult.value = null;
  testError.value = null;
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
      // 未填新密钥且地址未改时用已保存的配置测试，并顺带更新模型目录；已保存的密钥不会被发往表单中的新地址
      models = (await refreshAiProviderCatalogApi(editing.value.id)).models;
      emit('reload');
    } else {
      message.warning('修改了 Base URL，请同时填写 API Key 再测试');
      return;
    }
    testResult.value = protocolOf(values.protocol)?.discoverable
      ? `连接成功，供应商返回 ${models.length} 个模型。保存后存入模型目录，「添加模型」时从目录中选择。`
      : `该协议不提供模型列表，已载入 ${models.length} 个推荐型号，未验证远程连接或密钥。`;
  } catch (error) {
    testError.value = discoveryErrorMessage(error);
  } finally {
    testing.value = false;
  }
}

function open(provider?: AiProviderRecord) {
  editing.value = provider ?? null;
  testResult.value = null;
  testError.value = null;
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
      v-if="testError"
      class="mt-3"
      type="error"
      show-icon
      :message="testError"
    />
    <Alert
      v-if="testResult"
      class="mt-3"
      type="success"
      show-icon
      :message="testResult"
    />
  </Modal>
</template>
