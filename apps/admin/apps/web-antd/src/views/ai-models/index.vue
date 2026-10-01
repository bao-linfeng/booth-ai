<script setup lang="ts">
import type { AiModelRecord } from '#/api/core/ai-models';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Select,
  Switch,
  Tag,
} from 'ant-design-vue';

import { getAiModelsApi, updateAiModelApi } from '#/api/core/ai-models';

const models = ref<AiModelRecord[]>([]);
const loading = ref(false);
const saving = ref<null | string>(null);
const keyDrafts = ref<Record<string, string>>({});
const modelKey = (row: AiModelRecord) => `${row.purpose}:${row.provider}`;

async function load() {
  loading.value = true;
  try {
    models.value = await getAiModelsApi();
  } finally {
    loading.value = false;
  }
}
async function save(row: AiModelRecord) {
   saving.value = modelKey(row);
  try {
    await updateAiModelApi(row.provider, {
      purpose: row.purpose,
      enabled: row.enabled,
      priority: row.priority,
      unitCredits: row.unitCredits,
      expectedRevision: row.revision,
      ...(keyDrafts.value[modelKey(row)]?.trim()
        ? { apiKey: keyDrafts.value[modelKey(row)]?.trim() }
        : {}),
    });
    keyDrafts.value[modelKey(row)] = '';
    message.success('配置已保存');
    await load();
  } catch {
    await load();
  } finally {
    saving.value = null;
  }
}
async function clearKey(row: AiModelRecord) {
  saving.value = modelKey(row);
  try {
    await updateAiModelApi(row.provider, {
      purpose: row.purpose,
      enabled: false,
      priority: row.priority,
      unitCredits: row.unitCredits,
      expectedRevision: row.revision,
      apiKey: null,
    });
    keyDrafts.value[modelKey(row)] = '';
    message.success('密钥已清除，模型已停用');
    await load();
  } catch {
    await load();
  } finally {
    saving.value = null;
  }
}
onMounted(load);
</script>

<template>
  <Page
    title="AI 模型配置"
    description="智选解析按优先级调用主备模型；换主题模型及每张图的积分在客户端展示供用户选择。密钥在后台录入并加密保存。"
  >
    <div class="grid gap-5 lg:grid-cols-2">
      <Card
        v-for="purpose in ['selection_parse', 'theme', 'artwork'] as const"
        :key="purpose"
        :title="
          purpose === 'artwork' ? '四面平面素材 · 图像模型' : purpose === 'theme' ? 'AI 换主题 · 图像模型' : 'AI 智选 · 解析模型'
        "
        :loading="loading"
      >
        <div
          v-for="row in models.filter((item) => item.purpose === purpose)"
          :key="row.provider"
          class="mb-4 rounded-lg border p-4 last:mb-0"
        >
          <div class="mb-4 flex flex-wrap items-center gap-2">
            <strong>{{
              row.provider === 'qwen'
                ? '通义千问'
                : row.provider === 'deepseek'
                  ? 'DeepSeek'
                  : row.provider === 'gemini'
                    ? 'Gemini Nano Banana'
                    : row.provider === 'openai'
                      ? 'GPT Image (OpenAI)'
                      : '通义万相'
            }}</strong>
            <Tag>{{ row.model }}</Tag>
            <Tag :color="row.credentialConfigured ? 'success' : 'warning'">
              {{ row.credentialConfigured ? '凭据已配置' : '缺少凭据' }}
            </Tag>
          </div>
          <div class="mb-4 flex flex-wrap items-end gap-3">
            <label class="w-full max-w-md">API Key（留空则保留已有密钥）
              <Input.Password
                v-model:value="keyDrafts[modelKey(row)]"
                autocomplete="new-password"
                placeholder="输入新密钥，保存后生效"
                class="mt-1"
              />
            </label>
            <Popconfirm
              v-if="row.credentialConfigured"
              title="清除密钥并停用此模型？"
              @confirm="clearKey(row)"
            >
              <Button danger :disabled="saving === modelKey(row)">
                清除密钥
              </Button>
            </Popconfirm>
          </div>
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2">启用
              <Switch
                v-model:checked="row.enabled"
                :disabled="
                  !row.credentialConfigured && !keyDrafts[modelKey(row)]?.trim()
                "
            /></label>
            <label
              v-if="purpose === 'selection_parse'"
              class="flex items-center gap-2"
              >解析顺序
              <Select
                v-model:value="row.priority"
                class="w-28"
                :options="[
                  { label: '不参与', value: 0 },
                  { label: '主用', value: 1 },
                  { label: '备用', value: 2 },
                ]"
            /></label>
            <label v-else class="flex items-center gap-2">每张图积分
              <InputNumber
                :value="row.unitCredits ?? undefined"
                :min="1"
                :max="100000"
                @update:value="
                  (value) => {
                    row.unitCredits = typeof value === 'number' ? value : null;
                  }
                "
            /></label>
            <Button
              type="primary"
              :loading="saving === modelKey(row)"
              @click="save(row)"
            >
              保存
            </Button>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">
            保存后密钥不再显示 · 修订 {{ row.revision }}
          </p>
        </div>
      </Card>
    </div>
  </Page>
</template>
