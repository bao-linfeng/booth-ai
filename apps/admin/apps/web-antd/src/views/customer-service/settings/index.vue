<script setup lang="ts">
import type {
  CsEmailDelivery,
  CsLocale,
  CsSettings,
} from '#/api/core/customer-service';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import { Alert, Button, Card, message, Tag } from 'ant-design-vue';

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
const DELIVERY_STATUS: Record<
  CsEmailDelivery['status'],
  { color: string; label: string }
> = {
  failed: { color: 'error', label: '投递失败' },
  idle: { color: 'default', label: '暂无邮件' },
  pending: { color: 'processing', label: '待发送' },
  retrying: { color: 'warning', label: '重试中' },
  sent: { color: 'success', label: '已送达' },
};

const time = (value: null | string) => (value ? formatDateTime(value) : '—');

function deliveryDetail(item: CsEmailDelivery): string {
  switch (item.status) {
    case 'failed': {
      const reason =
        item.lastErrorCode === 'SMTP_EENVELOPE'
          ? '收件地址被拒绝，请检查邮箱是否填写正确'
          : `多次重试仍失败（${item.lastErrorCode ?? '未知错误'}）`;
      return `${time(item.lastFailedAt)} · ${reason}`;
    }
    case 'idle': {
      return '尚未产生离线通知';
    }
    case 'pending': {
      return `${item.pendingCount} 封待发送（未配置 SMTP 时会停留在队列中）`;
    }
    case 'retrying': {
      return `上次失败：${item.lastErrorCode}，${item.pendingCount} 封等待重试`;
    }
    case 'sent': {
      return `最近送达 ${time(item.lastSentAt)}`;
    }
  }
}
const router = useRouter();
const { hasAccessByCodes } = useAccess();
const editable = hasAccessByCodes(['customer-service.settings']);
const settings = ref<CsSettings | null>(null);
const saving = ref(false);

const [Form, formApi] = useVbenForm<FormValues>({
  showDefaultActions: false,
  commonConfig: {
    componentProps: { class: 'w-full', disabled: !editable },
    labelWidth: 120,
  },
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
      label: '通知邮箱',
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
      label: '回复邮件',
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
      <div
        v-if="settings?.offlineNotifyDelivery.length"
        class="mt-6 max-w-2xl border-t pt-4"
      >
        <div class="mb-3 flex items-center justify-between">
          <span class="font-medium">通知邮箱投递状态</span>
          <Button class="h-auto p-0" type="link" @click="load">刷新</Button>
        </div>
        <ul class="space-y-2">
          <li
            v-for="item in settings.offlineNotifyDelivery"
            :key="item.recipient"
            class="flex items-center gap-3 text-sm"
          >
            <span class="w-56 truncate" :title="item.recipient">
              {{ item.recipient }}
            </span>
            <Tag :color="DELIVERY_STATUS[item.status].color">
              {{ DELIVERY_STATUS[item.status].label }}
            </Tag>
            <span
              :class="
                item.status === 'failed'
                  ? 'text-red-500'
                  : 'text-muted-foreground'
              "
            >
              {{ deliveryDetail(item) }}
            </span>
          </li>
        </ul>
      </div>
    </Card>
  </Page>
</template>
