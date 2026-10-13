<script setup lang="ts">
import type {
  ArtworkDirection,
  ArtworkGenerationOptions,
  ArtworkGenerationSettings,
} from '#/api/core/ai-models';

import { computed, onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { formatDateTime } from '@vben/utils';

import {
  Alert,
  Button,
  Card,
  CheckboxGroup,
  Form,
  FormItem,
  message,
  RadioButton,
  RadioGroup,
  Spin,
  Switch,
  Tag,
} from 'ant-design-vue';

import {
  getArtworkGenerationSettingsApi,
  saveArtworkGenerationSettingsApi,
} from '#/api/core/ai-models';

const DIRECTION_OPTIONS: { label: string; value: ArtworkDirection }[] = [
  { label: '正面', value: 'front' },
  { label: '背面', value: 'back' },
  { label: '左侧', value: 'left' },
  { label: '右侧', value: 'right' },
];

const { hasAccessByCodes } = useAccess();
const canEdit = computed(() => hasAccessByCodes(['ai-models.assign']));

const saved = ref<ArtworkGenerationSettings>();
const draft = ref<ArtworkGenerationOptions>();
const loading = ref(false);
const saving = ref(false);

/** 方向按固定顺序比较，勾选先后不算改动 */
function optionsOf(
  settings: ArtworkGenerationOptions,
): ArtworkGenerationOptions {
  return {
    drawingDirections: DIRECTION_OPTIONS.map((option) => option.value).filter(
      (direction) => settings.drawingDirections.includes(direction),
    ),
    drawingGrayscale: settings.drawingGrayscale,
    directionConcurrency: settings.directionConcurrency,
  };
}

const dirty = computed(
  () =>
    !!saved.value &&
    !!draft.value &&
    JSON.stringify(optionsOf(saved.value)) !==
      JSON.stringify(optionsOf(draft.value)),
);
const drawingsEnabled = computed(
  () => (draft.value?.drawingDirections.length ?? 0) > 0,
);

async function load() {
  loading.value = true;
  try {
    saved.value = await getArtworkGenerationSettingsApi();
    draft.value = optionsOf(saved.value);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!saved.value || !draft.value) return;
  saving.value = true;
  try {
    saved.value = await saveArtworkGenerationSettingsApi({
      ...optionsOf(draft.value),
      expectedRevision: saved.value.revision,
    });
    draft.value = optionsOf(saved.value);
    message.success('四向图设置已保存');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Spin :spinning="loading">
    <Card v-if="draft && saved" title="AI 四向图 · 生图设置" size="small">
      <template #extra>
        <Tag v-if="dirty" color="warning">未保存</Tag>
      </template>
      <Alert
        class="mb-4"
        type="info"
        show-icon
        message="报馆图设置在用户报价时冻结：只影响之后报价并提交的任务，已提交或已报价的任务仍按当时的设置执行。方向并发数在任务开始生成时读取，对尚未开始的任务也生效。"
      />
      <Form layout="vertical" :disabled="!canEdit">
        <FormItem
          label="报馆图结构校正"
          extra="勾选的方向生成时，除主题图外再附带方案报馆图：俯视图 + 该方向立面；背面、右侧分别用正视图、左视图水平翻转。只使用已标注视向的图片格式报馆图（在「报馆图」页编辑视向），方案没有可用报馆图的方向仍只发送主题图。实测背面改善最明显；正面拱门等特征很强的方案，侧面仍可能画错。全部不勾选即关闭。"
        >
          <CheckboxGroup
            v-model:value="draft.drawingDirections"
            :options="DIRECTION_OPTIONS"
          />
        </FormItem>
        <FormItem
          label="报馆图去色"
          extra="去色后发送，避免报馆图里旧方案的品牌配色被带进结果。报馆图中的旧文字与标识由提示词禁止输出。"
        >
          <Switch
            v-model:checked="draft.drawingGrayscale"
            :disabled="!canEdit || !drawingsEnabled"
          />
        </FormItem>
        <FormItem
          label="单任务方向并发数"
          extra="一个四向图任务内同时生成的方向数。四个方向互不依赖，并发不影响出图效果：4 时总耗时约等于最慢的一个方向，1 时逐个方向生成、耗时约为 4 倍。供应商频繁限流（429）时调低。"
        >
          <RadioGroup v-model:value="draft.directionConcurrency">
            <RadioButton :value="1">1（逐个生成）</RadioButton>
            <RadioButton :value="2">2</RadioButton>
            <RadioButton :value="3">3</RadioButton>
            <RadioButton :value="4">4（同时生成）</RadioButton>
          </RadioGroup>
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
