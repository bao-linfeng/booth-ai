<script setup lang="ts">
import type {
  PromptDefinition,
  PromptPreview,
  PromptPreviewInput,
  PromptTemplate,
  TemplatePurpose,
} from '#/api/core/prompt-templates';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import {
  Alert,
  Modal as AntModal,
  Button,
  message,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createPromptTemplateApi,
  getPromptDefinitionsApi,
  getPromptTemplateApi,
  previewPromptApi,
  updatePromptTemplateApi,
} from '#/api/core/prompt-templates';
import { getSchemeOptionsApi } from '#/api/core/schemes';

type FormValues = {
  purpose: TemplatePurpose;
  industryId?: string;
  styleId?: string;
  body: string;
  sampleText?: string;
  sampleIndustryId?: string;
  sampleStyleId?: string;
  sampleColors?: string;
  sampleKeywords?: string;
};

const emit = defineEmits<{ reload: [] }>();
const definitions = ref<PromptDefinition[]>([]);
const purpose = ref<TemplatePurpose>('filter');
const definition = computed(() =>
  definitions.value.find((item) => item.purpose === purpose.value),
);
const editing = ref<null | PromptTemplate>(null);
const drafts: Partial<Record<TemplatePurpose, string>> = {};
const initializing = ref(false);
const preview = ref<null | PromptPreview>(null);
const previewLoading = ref(false);
const previewStale = ref(false);
const ready = ref(false);
const loadError = ref(false);
const submitting = ref(false);
let previewSequence = 0;
let openSequence = 0;

function invalidatePreview() {
  previewSequence++;
  previewLoading.value = false;
  if (preview.value) previewStale.value = true;
}

async function changePurpose(next: TemplatePurpose, body: string) {
  if (initializing.value || editing.value || next === purpose.value) return;
  drafts[purpose.value] = body ?? '';
  purpose.value = next;
  preview.value = null;
  invalidatePreview();
  await formApi.setValues({
    body:
      drafts[next] ??
      definitions.value.find((item) => item.purpose === next)?.defaultBody ??
      '',
  });
}

const imageOnly = {
  triggerFields: ['purpose'],
  show: (values: Record<string, unknown>) => values.purpose !== 'filter',
};
const [Form, formApi] = useVbenForm<FormValues>({
  wrapperClass: 'grid-cols-1 md:grid-cols-2',
  showDefaultActions: false,
  handleSubmit: async (raw) => {
    const values = raw;
    const submitSequence = openSequence;
    submitting.value = true;
    modalApi.setState({ confirmLoading: true });
    try {
      const checked = await previewPromptApi({
        purpose: values.purpose,
        body: values.body,
        sample: {},
      });
      if (checked.issues.length > 0) {
        preview.value = checked;
        previewStale.value = false;
        message.error('请先修正提示词中的校验问题');
        return;
      }
      if (submitSequence !== openSequence) return;
      editing.value
        ? await updatePromptTemplateApi(editing.value.id, {
            body: values.body,
            expectedRevision: editing.value.revision,
          })
        : await createPromptTemplateApi({
            purpose: values.purpose,
            body: values.body,
            industryId:
              values.purpose === 'filter' ? null : values.industryId || null,
            styleId:
              values.purpose === 'filter' ? null : values.styleId || null,
          });
      if (submitSequence !== openSequence) return;
      message.success(
        editing.value
          ? '模板已更新，新请求将使用最新启用配置'
          : '已保存为停用模板，请在列表启用后使用',
      );
      emit('reload');
      modalApi.close();
    } catch {
      message.error(
        '保存失败，请检查模板配置；如发生版本冲突，请关闭后重新打开',
      );
    } finally {
      submitting.value = false;
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Select',
      fieldName: 'purpose',
      label: '业务用途',
      rules: 'selectRequired',
      componentProps: { class: 'w-full', options: [] },
      dependencies: {
        triggerFields: ['purpose'],
        trigger: (values) =>
          changePurpose(
            values.purpose as TemplatePurpose,
            values.body as string,
          ),
      },
    },
    {
      component: 'Select',
      fieldName: 'industryId',
      label: '适用行业',
      dependencies: imageOnly,
      componentProps: {
        class: 'w-full',
        allowClear: true,
        placeholder: '通用 · 所有行业',
        options: [],
      },
    },
    {
      component: 'Select',
      fieldName: 'styleId',
      label: '适用风格',
      dependencies: imageOnly,
      componentProps: {
        class: 'w-full',
        allowClear: true,
        placeholder: '通用 · 所有风格',
        options: [],
      },
    },
    {
      component: 'Textarea',
      fieldName: 'body',
      label: '业务提示词',
      rules: 'required',
      formItemClass: 'md:col-span-2',
      componentProps: {
        rows: 14,
        maxlength: 30_000,
        showCount: true,
        class: 'font-mono text-sm',
        onChange: invalidatePreview,
      },
    },
    {
      component: 'Textarea',
      fieldName: 'sampleText',
      label: '示例原文',
      formItemClass: 'md:col-span-2',
      dependencies: {
        triggerFields: ['purpose'],
        show: (values) => values.purpose === 'filter',
      },
      componentProps: { rows: 3, maxlength: 1000, onChange: invalidatePreview },
    },
    {
      component: 'Select',
      fieldName: 'sampleIndustryId',
      label: '示例行业',
      dependencies: imageOnly,
      componentProps: {
        class: 'w-full',
        allowClear: true,
        placeholder: '选择实际字典项',
        options: [],
        onChange: invalidatePreview,
      },
    },
    {
      component: 'Select',
      fieldName: 'sampleStyleId',
      label: '示例风格',
      dependencies: imageOnly,
      componentProps: {
        class: 'w-full',
        allowClear: true,
        placeholder: '选择实际字典项',
        options: [],
        onChange: invalidatePreview,
      },
    },
    {
      component: 'Input',
      fieldName: 'sampleColors',
      label: '示例品牌色',
      dependencies: imageOnly,
      componentProps: {
        placeholder: '#2563EB, #FFFFFF（最多 3 色）',
        onChange: invalidatePreview,
      },
    },
    {
      component: 'Input',
      fieldName: 'sampleKeywords',
      label: '示例补充要求',
      dependencies: imageOnly,
      componentProps: {
        maxlength: 200,
        placeholder: '灵通医疗，突出精准与关怀，不要红色',
        onChange: invalidatePreview,
      },
    },
  ],
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: () => {
    if (!submitting.value) return formApi.validateAndSubmitForm();
  },
  onCancel: () => {
    if (!submitting.value) modalApi.close();
  },
  onClosed: () => {
    if (!submitting.value) {
      openSequence++;
      invalidatePreview();
    }
  },
});

function variableToken(name: string) {
  return `{{${name}}}`;
}

async function insertVariable(name: string) {
  const values = await formApi.getValues<FormValues>();
  await formApi.setValues({ body: `${values.body ?? ''}{{${name}}}` });
  invalidatePreview();
}

function restoreDefault() {
  AntModal.confirm({
    title: '载入该用途的内置默认正文？',
    content: '将替换当前编辑区正文，保存后才会更新模板。',
    onOk: async () => {
      await formApi.setValues({ body: definition.value?.defaultBody ?? '' });
      invalidatePreview();
    },
  });
}

async function renderPreview() {
  const values = await formApi.getValues<FormValues>();
  const colors = (values.sampleColors ?? '').split(/[,，\s]+/).filter(Boolean);
  if (
    values.purpose !== 'filter' &&
    (colors.length > 3 || colors.some((color) => !/^#[\da-f]{6}$/i.test(color)))
  ) {
    message.error('示例品牌色需为 #RRGGBB 格式，最多 3 色，以逗号分隔');
    return;
  }
  const sample: PromptPreviewInput['sample'] =
    values.purpose === 'filter'
      ? { text: values.sampleText }
      : {
          industryId: values.sampleIndustryId || undefined,
          styleId: values.sampleStyleId || undefined,
          brandColors: colors,
          brandKeywords: values.sampleKeywords,
        };
  const sequence = ++previewSequence;
  previewLoading.value = true;
  try {
    const result = await previewPromptApi({
      purpose: values.purpose,
      body: values.body ?? '',
      sample,
    });
    if (sequence !== previewSequence) return;
    preview.value = result;
    previewStale.value = false;
  } catch {
    if (sequence === previewSequence) {
      message.error('预览生成失败，请稍后重试');
    }
  } finally {
    if (sequence === previewSequence) previewLoading.value = false;
  }
}

async function open(row?: PromptTemplate, mode: 'edit' | 'preview' = 'edit') {
  const sequence = ++openSequence;
  ready.value = false;
  loadError.value = false;
  initializing.value = true;
  editing.value = row ?? null;
  preview.value = null;
  invalidatePreview();
  Object.keys(drafts).forEach((key) => {
    drafts[key as TemplatePurpose] = undefined;
  });
  modalApi.setState({
    title:
      mode === 'preview'
        ? '预览提示词模板'
        : row
          ? '编辑提示词模板'
          : '新建提示词模板',
    showConfirmButton: mode !== 'preview',
    confirmDisabled: true,
  });
  modalApi.open();
  try {
    await formApi.resetForm();
    const [items, options, detail] = await Promise.all([
      getPromptDefinitionsApi(),
      getSchemeOptionsApi(),
      row ? getPromptTemplateApi(row.id) : Promise.resolve(null),
    ]);
    if (sequence !== openSequence) return;
    definitions.value = items;
    editing.value = detail;
    purpose.value = detail?.purpose ?? 'filter';
    const industries = (options.industry ?? []).map((item) => ({
      label: item.label,
      value: item.id,
    }));
    const styles = (options.style ?? []).map((item) => ({
      label: item.label,
      value: item.id,
    }));
    await formApi.updateSchema([
      {
        fieldName: 'purpose',
        componentProps: {
          disabled: Boolean(detail),
          options: items.map((item) => ({
            label: item.label,
            value: item.purpose,
          })),
        },
      },
      {
        fieldName: 'industryId',
        componentProps: { disabled: Boolean(detail), options: industries },
      },
      {
        fieldName: 'styleId',
        componentProps: { disabled: Boolean(detail), options: styles },
      },
      {
        fieldName: 'sampleIndustryId',
        componentProps: { options: industries },
      },
      { fieldName: 'sampleStyleId', componentProps: { options: styles } },
    ]);
    await formApi.setValues({
      purpose: purpose.value,
      industryId: detail?.industryId ?? undefined,
      styleId: detail?.styleId ?? undefined,
      body: detail?.body ?? definition.value?.defaultBody ?? '',
      sampleText: '长六米，宽3米，限高四米，希望有洽谈区，不要储藏间。',
      sampleIndustryId: detail?.industryId ?? industries[0]?.value,
      sampleStyleId: detail?.styleId ?? styles[0]?.value,
      sampleColors: '#2563EB, #FFFFFF',
      sampleKeywords: '灵通医疗，突出精准与关怀，不要红色',
    });
    ready.value = true;
    modalApi.setState({ confirmDisabled: false });
  } catch {
    if (sequence === openSequence) loadError.value = true;
  } finally {
    if (sequence === openSequence) initializing.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <Modal
    class="w-[1180px] max-w-[96vw]"
    :title="editing ? '编辑提示词模板' : '新建提示词模板'"
  >
    <Alert
      v-if="loadError"
      type="error"
      show-icon
      message="模板定义加载失败，请关闭后重新打开。"
    />
    <div
      v-else
      class="space-y-5"
      :class="{ 'pointer-events-none opacity-50': !ready }"
    >
      <div
        class="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/30 p-4"
      >
        <div class="space-y-1">
          <div class="text-base font-semibold">
            {{ definition?.label ?? '加载模板定义…' }}
          </div>
          <p class="text-muted-foreground text-xs">{{ definition?.scope }}</p>
          <p class="text-muted-foreground text-xs">
            保存业务指令，运行时自动注入用户数据；已受理任务保留原提示词快照。
          </p>
        </div>
        <Tag :color="editing?.enabled ? 'green' : 'default'">
          {{
            editing?.enabled
              ? '已启用 · 保存后影响新请求'
              : '停用 · 保存后可在列表启用'
          }}
        </Tag>
      </div>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0"><Form /></div>
        <aside class="space-y-5 rounded-lg border bg-muted/20 p-4">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-semibold">动态输入</h3>
            <Tag>默认 v{{ definition?.defaultVersion }}</Tag>
          </div>
          <ul class="text-muted-foreground space-y-2 text-xs leading-6">
            <li v-for="input in definition?.inputs" :key="input">
              {{ input }}
            </li>
          </ul>
          <div v-if="definition?.variables.length" class="space-y-4">
            <p class="text-xs font-medium">点击变量插入正文末尾</p>
            <div
              v-for="variable in definition.variables"
              :key="variable.name"
              class="space-y-1 border-t pt-3"
            >
              <Button size="small" @click="insertVariable(variable.name)">
                <code>{{ variableToken(variable.name) }}</code>
              </Button>
              <p class="text-xs font-medium">{{ variable.label }}</p>
              <p class="text-muted-foreground text-xs leading-5">
                {{ variable.source }}
              </p>
              <p class="text-muted-foreground text-xs">
                示例：{{ variable.example }}
              </p>
              <p class="text-muted-foreground text-xs leading-5">
                空值：{{ variable.fallback }}
              </p>
            </div>
          </div>
          <Alert
            v-else
            type="info"
            message="原文和字典通过 user 消息自动发送，无需在系统正文插入占位符。"
          />
          <Button block @click="restoreDefault">载入内置默认正文</Button>
          <details class="text-xs">
            <summary class="cursor-pointer font-medium">
              查看系统固定约束
            </summary>
            <pre
              class="text-muted-foreground mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono leading-5"
              >{{ definition?.fixedInstructions }}</pre>
          </details>
        </aside>
      </div>
      <section class="space-y-3 border-t pt-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold">最终请求预览</h3>
            <p class="text-muted-foreground mt-1 text-xs">
              使用同一套服务端组装逻辑；只渲染示例，不调用模型、不消耗积分。
            </p>
          </div>
          <Button
            v-access:code="['prompts.preview']"
            :loading="previewLoading"
            @click="renderPreview"
          >
            校验并生成预览
          </Button>
        </div>
        <Alert
          v-if="previewStale"
          type="warning"
          show-icon
          message="正文或示例已修改，请重新生成预览。"
        />
        <template v-if="preview">
          <Alert
            v-for="(issue, index) in preview.issues"
            :key="index"
            type="error"
            show-icon
            :message="
              issue.message +
              (issue.offset === undefined
                ? ''
                : `（字符位置 ${issue.offset + 1}）`)
            "
          />
          <template v-if="!preview.issues.length">
            <div class="text-muted-foreground flex flex-wrap gap-2 text-xs">
              <Tag color="green">校验通过</Tag>
              <span
                v-for="attachment in preview.attachments"
                :key="attachment"
                >{{ attachment }}</span
              >
              <span v-if="preview.dictionaryVersion">
                实时字典版本：{{ preview.dictionaryVersion }}</span
              >
            </div>
            <Tabs v-if="preview.directionPrompts">
              <TabPane
                v-for="direction in ['front', 'back', 'left', 'right'] as const"
                :key="direction"
                :tab="
                  { front: '正面', back: '背面', left: '左侧', right: '右侧' }[
                    direction
                  ]
                "
              >
                <pre
                  class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 font-mono text-xs leading-6"
                  >{{ preview.directionPrompts[direction] }}</pre>
              </TabPane>
            </Tabs>
            <div
              v-for="item in preview.messages"
              :key="item.role"
              class="space-y-2"
            >
              <span
                class="text-muted-foreground text-xs font-semibold uppercase"
                >{{ item.role }}</span
              >
              <pre
                class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 font-mono text-xs leading-6"
                >{{ item.content }}</pre>
            </div>
          </template>
        </template>
        <p
          v-else
          class="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm"
        >
          填写示例输入，查看变量替换、固定约束与最终请求内容。
        </p>
      </section>
    </div>
  </Modal>
</template>
