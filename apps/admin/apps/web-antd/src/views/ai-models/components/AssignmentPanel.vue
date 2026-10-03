<script setup lang="ts">
import type {
  AiModelRecord,
  AiProtocol,
  AiProviderRecord,
  AiPurpose,
  AssignmentItem,
  PurposeAssignment,
} from '#/api/core/ai-models';

import { computed, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Card,
  Empty,
  InputNumber,
  message,
  Select,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  PURPOSE_LABELS,
  saveAiModelAssignmentsApi,
} from '#/api/core/ai-models';

const props = defineProps<{
  assignments: PurposeAssignment[];
  protocols: AiProtocol[];
  providers: AiProviderRecord[];
}>();
const emit = defineEmits<{ reload: [] }>();

const PURPOSE_HINTS: Record<AiPurpose, string> = {
  selection_parse:
    '按顺序调用，第一个为主用，失败时在 2.8 秒预算内切换下一个；全部失败时回退规则解析。不计积分。',
  theme:
    '按顺序回退：第一个可用模型为主用，失败时依次尝试后续模型。积分按张计，客户端报价按主用模型单价。',
  artwork:
    '只使用第一个可用模型生成四个方向，不跨模型回退。积分按方向计（每套 4 个方向）。',
};
const UNIT_LABELS: Record<AiPurpose, string> = {
  selection_parse: '',
  theme: '积分/张',
  artwork: '积分/方向',
};

type ModelOption = AiModelRecord & { provider: AiProviderRecord };

const drafts = ref<Record<string, AssignmentItem[]>>({});
const saving = ref<AiPurpose | null>(null);

watch(
  () => props.assignments,
  (assignments) => {
    drafts.value = Object.fromEntries(
      assignments.map((item) => [
        item.purpose,
        item.items.map((entry) => ({ ...entry })),
      ]),
    );
  },
  { immediate: true },
);

const models = computed<ModelOption[]>(() =>
  props.providers.flatMap((provider) =>
    provider.models.map((model) => ({ ...model, provider })),
  ),
);

function supports(model: ModelOption, purpose: AiPurpose) {
  const protocol = props.protocols.find(
    (item) => item.id === model.provider.protocol,
  );
  return Boolean(
    protocol?.kinds.some(
      (item) => item.kind === model.kind && item.purposes.includes(purpose),
    ),
  );
}

function candidates(purpose: AiPurpose) {
  return models.value.filter((model) => supports(model, purpose));
}

/** Why an assigned model would be skipped at runtime, or null when it is usable. */
function inactiveReason(modelId: string) {
  const model = models.value.find((item) => item.id === modelId);
  if (!model) return '模型已删除';
  if (!model.enabled) return '模型已停用';
  if (!model.provider.enabled) return '供应商已停用';
  if (!model.provider.credentialConfigured) return '供应商缺少 API Key';
  return null;
}

function dirty(purpose: AiPurpose) {
  const saved =
    props.assignments.find((item) => item.purpose === purpose)?.items ?? [];
  return JSON.stringify(saved) !== JSON.stringify(drafts.value[purpose] ?? []);
}

function add(purpose: AiPurpose) {
  const used = new Set(
    (drafts.value[purpose] ?? []).map((item) => item.modelId),
  );
  const next = candidates(purpose).find((model) => !used.has(model.id));
  if (!next) {
    message.info('没有更多可分配的模型，请先在「供应商与模型」中添加');
    return;
  }
  drafts.value[purpose] = [
    ...(drafts.value[purpose] ?? []),
    { modelId: next.id, unitCredits: purpose === 'selection_parse' ? null : 1 },
  ];
}

function move(purpose: AiPurpose, index: number, offset: -1 | 1) {
  const items = [...(drafts.value[purpose] ?? [])];
  const [item] = items.splice(index, 1);
  if (!item) return;
  items.splice(index + offset, 0, item);
  drafts.value[purpose] = items;
}

function remove(purpose: AiPurpose, index: number) {
  drafts.value[purpose] = (drafts.value[purpose] ?? []).filter(
    (_, position) => position !== index,
  );
}

async function save(purpose: AiPurpose) {
  const items = drafts.value[purpose] ?? [];
  if (
    purpose !== 'selection_parse' &&
    items.some((item) => !item.unitCredits)
  ) {
    message.warning('请为每个模型填写积分');
    return;
  }
  const current = props.assignments.find((item) => item.purpose === purpose);
  if (!current) return;
  saving.value = purpose;
  try {
    await saveAiModelAssignmentsApi(purpose, {
      expectedVersion: current.version,
      items,
    });
    message.success(`${PURPOSE_LABELS[purpose]}的模型分配已保存`);
    emit('reload');
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-3">
    <Card
      v-for="assignment in assignments"
      :key="assignment.purpose"
      :title="PURPOSE_LABELS[assignment.purpose]"
      size="small"
    >
      <template #extra>
        <Tag v-if="dirty(assignment.purpose)" color="warning">未保存</Tag>
      </template>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ PURPOSE_HINTS[assignment.purpose] }}
      </p>
      <Empty
        v-if="!drafts[assignment.purpose]?.length"
        description="未分配模型，此功能不可用"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      />
      <div
        v-for="(item, index) in drafts[assignment.purpose]"
        :key="item.modelId"
        class="mb-2 flex items-center gap-2 rounded-md border p-2"
      >
        <Tag :color="index === 0 ? 'blue' : 'default'" class="m-0 shrink-0">
          {{ index === 0 ? '主用' : `备用 ${index}` }}
        </Tag>
        <Select
          v-model:value="item.modelId"
          class="min-w-0 flex-1"
          :options="
            candidates(assignment.purpose).map((model) => ({
              label: `${model.name} · ${model.provider.name}`,
              value: model.id,
              disabled:
                model.id !== item.modelId &&
                drafts[assignment.purpose]!.some(
                  (other) => other.modelId === model.id,
                ),
            }))
          "
        />
        <InputNumber
          v-if="assignment.purpose !== 'selection_parse'"
          :value="item.unitCredits ?? undefined"
          @update:value="
            (value) =>
              (item.unitCredits = typeof value === 'number' ? value : null)
          "
          class="w-28 shrink-0"
          :min="1"
          :max="100000"
          :precision="0"
          :addon-after="UNIT_LABELS[assignment.purpose]"
        />
        <Tooltip
          v-if="inactiveReason(item.modelId)"
          :title="`运行时会跳过：${inactiveReason(item.modelId)}`"
        >
          <Tag color="error" class="m-0 shrink-0">未生效</Tag>
        </Tooltip>
        <Button
          size="small"
          :disabled="index === 0"
          @click="move(assignment.purpose, index, -1)"
        >
          ↑
        </Button>
        <Button
          size="small"
          :disabled="index === drafts[assignment.purpose]!.length - 1"
          @click="move(assignment.purpose, index, 1)"
        >
          ↓
        </Button>
        <Button size="small" danger @click="remove(assignment.purpose, index)">
          移除
        </Button>
      </div>
      <Alert
        v-if="!candidates(assignment.purpose).length"
        class="mt-2"
        type="info"
        show-icon
        message="还没有能用于此用途的模型"
      />
      <div class="mt-3 flex justify-between">
        <Button size="small" @click="add(assignment.purpose)">添加模型</Button>
        <Button
          type="primary"
          size="small"
          :disabled="!dirty(assignment.purpose)"
          :loading="saving === assignment.purpose"
          @click="save(assignment.purpose)"
        >
          保存
        </Button>
      </div>
    </Card>
  </div>
</template>
