<script setup lang="ts">
import type { CsLocale, CsSettings } from '#/api/core/customer-service';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Alert, Button, Card, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  CS_LOCALE_LABELS,
  getCsSettingsApi,
  saveCsSettingsApi,
} from '#/api/core/customer-service';

type FormValues = {
  agentLocale: CsLocale;
  offlineNotifyEmails: string[];
  replyEmailEnabled: boolean;
  translationEnabled: boolean;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const router = useRouter();
const { hasAccessByCodes } = useAccess();
const editable = hasAccessByCodes(['customer-service.settings']);
const settings = ref<CsSettings | null>(null);
const saving = ref(false);

const [Form, formApi] = useVbenForm<FormValues>({
  showDefaultActions: false,
  commonConfig: { componentProps: { class: 'w-full', disabled: !editable } },
  wrapperClass: 'grid-cols-1 max-w-2xl',
  schema: [
    {
      component: 'Switch',
      fieldName: 'translationEnabled',
      label: '启用翻译',
      help: '开启且已分配翻译模型时，客户消息译为坐席语言，坐席回复译为客户语言；关闭后只显示原文',
    },
    {
      component: 'Select',
      fieldName: 'agentLocale',
      label: '坐席语言',
      rules: 'selectRequired',
      componentProps: {
        options: Object.entries(CS_LOCALE_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      help: '坐席用该语言回复；客户消息翻译为该语言',
    },
    {
      component: 'Select',
      fieldName: 'offlineNotifyEmails',
      label: '离线通知邮箱',
      componentProps: {
        mode: 'tags',
        maxTagCount: 20,
        placeholder: '输入邮箱后回车，最多 20 个',
        tokenSeparators: [',', ';', ' '],
      },
      help: '客服都不在线时客户留言，系统会发邮件到这些地址（同一会话 10 分钟内合并为一封）',
    },
    {
      component: 'Switch',
      fieldName: 'replyEmailEnabled',
      label: '离线客户回复邮件',
      help: '坐席回复时客户不在线，5 分钟后把回复摘要发到客户邮箱；客户期间上线或已读则不发',
    },
  ],
  handleSubmit: async (values) => {
    if (!settings.value) return;
    const emails = values.offlineNotifyEmails
      .map((email) => email.trim())
      .filter(Boolean);
    const invalid = emails.find((email) => !EMAIL.test(email));
    if (invalid) {
      message.warning(`邮箱格式不正确：${invalid}`);
      return;
    }
    if (emails.length > 20) {
      message.warning('离线通知邮箱最多 20 个');
      return;
    }
    saving.value = true;
    try {
      settings.value = await saveCsSettingsApi({
        agentLocale: values.agentLocale,
        expectedRevision: settings.value.revision,
        offlineNotifyEmails: emails,
        replyEmailEnabled: values.replyEmailEnabled,
        translationEnabled: values.translationEnabled,
      });
      await fill(settings.value);
      message.success('已保存');
    } catch (error) {
      // 修订冲突：提示已由拦截器给出，这里重新加载最新设置
      if (
        (error as { response?: { status?: number } }).response?.status === 409
      )
        await load();
    } finally {
      saving.value = false;
    }
  },
});

async function fill(value: CsSettings) {
  await formApi.setValues({
    agentLocale: value.agentLocale,
    offlineNotifyEmails: value.offlineNotifyEmails,
    replyEmailEnabled: value.replyEmailEnabled,
    translationEnabled: value.translationEnabled,
  });
}

async function load() {
  settings.value = await getCsSettingsApi();
  await fill(settings.value);
}

onMounted(load);
</script>

<template>
  <Page auto-content-height>
    <Card title="客服设置">
      <template v-if="settings" #extra>
        <span class="text-xs text-muted-foreground">
          修订 {{ settings.revision }} · 更新于
          {{ formatDateTime(settings.updatedAt) }}
        </span>
      </template>
      <Alert
        v-if="settings && !settings.translationModelAssigned"
        class="mb-4 max-w-2xl"
        show-icon
        type="warning"
      >
        <template #message>
          尚未在 AI 模型配置中为「在线客服 · 消息翻译」分配模型，翻译不会生效。
          <Button
            v-access:code="['ai-models.read']"
            class="h-auto p-0"
            type="link"
            @click="router.push({ name: 'AiModels' })"
          >
            前往分配
          </Button>
        </template>
      </Alert>
      <Alert
        v-if="!editable"
        class="mb-4 max-w-2xl"
        message="没有修改客服设置的权限，当前为只读"
        show-icon
        type="info"
      />
      <Form />
      <div v-if="editable" class="max-w-2xl text-right">
        <Button
          :loading="saving"
          type="primary"
          @click="formApi.validateAndSubmitForm()"
        >
          保存
        </Button>
      </div>
    </Card>
  </Page>
</template>
