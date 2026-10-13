<script setup lang="ts">
import type {
  ThemeGenerationOptions,
  ThemeGenerationSettings,
} from '#/api/core/ai-models';

import { computed, onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { formatDateTime } from '@vben/utils';

import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Input,
  message,
  RadioButton,
  RadioGroup,
  Spin,
  Switch,
  Tag,
} from 'ant-design-vue';

import {
  getThemeGenerationSettingsApi,
  saveThemeGenerationSettingsApi,
} from '#/api/core/ai-models';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const { hasAccessByCodes } = useAccess();
const canEdit = computed(() => hasAccessByCodes(['ai-models.assign']));

const saved = ref<ThemeGenerationSettings>();
const draft = ref<ThemeGenerationOptions>();
const loading = ref(false);
const saving = ref(false);

function optionsOf(settings: ThemeGenerationSettings): ThemeGenerationOptions {
  const { sendMask, composite, backgroundMode, backgroundColor } = settings;
  return { sendMask, composite, backgroundMode, backgroundColor };
}

const dirty = computed(
  () =>
    !!saved.value &&
    !!draft.value &&
    JSON.stringify(optionsOf(saved.value)) !== JSON.stringify(draft.value),
);
const colorValid = computed(() =>
  HEX_COLOR.test(draft.value?.backgroundColor ?? ''),
);

async function load() {
  loading.value = true;
  try {
    saved.value = await getThemeGenerationSettingsApi();
    draft.value = optionsOf(saved.value);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!saved.value || !draft.value) return;
  if (!colorValid.value) {
    message.warning('请填写 #RRGGBB 格式的铺底颜色');
    return;
  }
  saving.value = true;
  try {
    saved.value = await saveThemeGenerationSettingsApi({
      ...draft.value,
      expectedRevision: saved.value.revision,
    });
    draft.value = optionsOf(saved.value);
    message.success('换主题设置已保存，之后提交的任务生效');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Spin :spinning="loading">
    <Card v-if="draft && saved" title="AI 换主题 · 生图设置" size="small">
      <template #extra>
        <Tag v-if="dirty" color="warning">未保存</Tag>
      </template>
      <Alert
        class="mb-4"
        type="info"
        show-icon
        message="设置在用户报价时冻结：只影响之后报价并提交的任务，已提交或已报价的任务仍按当时的设置执行。"
      />
      <Form layout="vertical" :disabled="!canEdit">
        <FormItem
          label="发送蒙版"
          extra="把方案蒙版（品红区域）作为可编辑区域发给模型。只有支持蒙版的协议（OpenAI 兼容）会使用；实测 gpt-image 只把蒙版当参考，不保证蒙版外不变。"
        >
          <Switch v-model:checked="draft.sendMask" />
        </FormItem>
        <FormItem
          label="出图后蒙版合成"
          extra="出图后自动对齐原图，只保留蒙版区域的新画面，结构、家具、展品与背景还原为原图。模型改了视角或变形过大无法对齐时，该张保留模型原图；方案没有蒙版时不合成。"
        >
          <Switch v-model:checked="draft.composite" />
        </FormItem>
        <FormItem
          label="原图透明背景"
          extra="效果图多为透明背景 PNG，直接发送时模型会自行补画天空、地面等环境。铺纯色后再发送可减少这种情况；开启合成时，结果的背景会还原为透明。"
        >
          <RadioGroup v-model:value="draft.backgroundMode">
            <RadioButton value="fill">铺纯色后发送</RadioButton>
            <RadioButton value="transparent">保持透明</RadioButton>
          </RadioGroup>
          <div
            v-if="draft.backgroundMode === 'fill'"
            class="mt-3 flex items-center gap-2"
          >
            <input
              v-model="draft.backgroundColor"
              type="color"
              aria-label="铺底颜色"
              class="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
              :disabled="!canEdit"
            />
            <Input
              v-model:value="draft.backgroundColor"
              class="w-32"
              :maxlength="7"
              :status="colorValid ? undefined : 'error'"
            />
          </div>
        </FormItem>
      </Form>
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">
          最后修改：{{ formatDateTime(saved.updatedAt) }}
        </span>
        <Button
          v-access:code="['ai-models.assign']"
          type="primary"
          :disabled="!dirty"
          :loading="saving"
          @click="save"
        >
          保存
        </Button>
      </div>
    </Card>
  </Spin>
</template>
