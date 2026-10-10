import type pg from 'pg';
import { buildSelectionMessages, extractionInstruction, SELECTION_FIXED_INSTRUCTIONS } from '../selection/prompt.js';
import { loadCatalog } from '../selection/repository.js';
import { buildThemePrompt, DEFAULT_THEME_BODY, THEME_FIXED_INSTRUCTIONS } from '../generation/theme/prompt.js';
import { normalizeThemeInput } from '../generation/theme/domain.js';
import { ARTWORK_FIXED_INSTRUCTIONS, buildArtworkPrompts, DEFAULT_ARTWORK_BODY } from '../generation/artwork/prompt.js';
import { inspectPrompt, PROMPT_DEFAULT_VERSION, type PromptPurpose } from '../prompts/template.js';

const brandVariables = [
  { name: 'industryLabel', label: '行业名称', source: '用户选择的行业字典项；四向图继承所选主题任务', example: '医疗器械', fallback: '换主题必填；四向图以参考图为准' },
  { name: 'styleLabel', label: '风格名称', source: '用户选择的风格字典项；四向图继承所选主题任务', example: '现代简约', fallback: '换主题必填；四向图以参考图为准' },
  { name: 'brandColors', label: '品牌色', source: '用户填写的品牌色，按主色、辅助色顺序', example: '#2563EB, #FFFFFF', fallback: '换主题：未指定；四向图：沿用参考图已有配色' },
  { name: 'brandKeywords', label: '品牌及补充要求', source: '用户填写的品牌关键词、标语与补充要求', example: '灵通医疗，突出精准与关怀，不要红色', fallback: '换主题：未填写；四向图：沿用参考图已有品牌与主题' },
];

export function promptDefinitions() {
  return [
    { purpose: 'filter', label: 'AI 智选 · 需求解析', defaultBody: extractionInstruction, defaultVersion: PROMPT_DEFAULT_VERSION,
      fixedInstructions: SELECTION_FIXED_INSTRUCTIONS, variables: [], scope: '仅全局通用；解析前不按行业或风格选择模板。',
      inputs: ['text：本次用户原文，独立放入 user 消息。', 'dictionaries：服务端实时筛选字典与展位空间。', '当前表单值由服务端与解析结果合并，未提及字段保留。'] },
    { purpose: 'theme', label: 'AI 换主题', defaultBody: DEFAULT_THEME_BODY, defaultVersion: PROMPT_DEFAULT_VERSION,
      fixedInstructions: THEME_FIXED_INSTRUCTIONS, variables: brandVariables, scope: '行业+风格 → 行业 → 风格 → 通用 → 内置默认。',
      inputs: ['行业、风格、品牌色和补充要求总会注入，不依赖正文是否引用变量。', '原始效果图和可用蒙版由任务资产绑定，经图像接口发送。'] },
    { purpose: 'artwork', label: 'AI 四向图', defaultBody: DEFAULT_ARTWORK_BODY, defaultVersion: PROMPT_DEFAULT_VERSION,
      fixedInstructions: ARTWORK_FIXED_INSTRUCTIONS, variables: [...brandVariables,
        { name: 'directionLabel', label: '目标方向', source: '服务端分别展开为正面、背面、左侧、右侧', example: '左侧', fallback: '系统必定注入' }],
      scope: '沿用所选主题任务的行业和风格匹配；行业+风格 → 行业 → 风格 → 通用 → 内置默认。',
      inputs: ['参考图为用户最终选中的主题效果图版本。', '行业、风格、品牌色和关键词继承该主题任务。', '每个方向的相机和遮挡约束由系统自动注入。'] },
  ];
}

export interface PreviewInput {
  purpose: PromptPurpose;
  body: string;
  sample?: { text?: string; industryId?: string; styleId?: string; brandColors?: string[]; brandKeywords?: string };
}

export async function previewPrompt(pool: pg.Pool, input: PreviewInput) {
  const validation = inspectPrompt(input.purpose, input.body);
  if (validation.issues.length) return { ...validation, messages: [], directionPrompts: null, attachments: [] };
  const sample = input.sample ?? {};
  if (input.purpose === 'filter') {
    const catalog = await loadCatalog(pool);
    return { ...validation, messages: buildSelectionMessages(sample.text ?? '长六米，宽3米，限高四米，希望有洽谈区，不要储藏间。', catalog, input.body),
      directionPrompts: null, attachments: [], dictionaryVersion: catalog.dictionaryVersion };
  }
  const labels = sample.industryId || sample.styleId ? (await pool.query<{ id: string; label: string; code: string }>(
    `SELECT i.id::text AS id, i.item_label AS label, d.code FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id
     WHERE i.id=ANY($1::uuid[]) AND i.enabled AND d.enabled`, [[sample.industryId, sample.styleId].filter(Boolean)],
  )).rows : [];
  const industryLabel = labels.find(row => row.id === sample.industryId && row.code === 'industry')?.label;
  const styleLabel = labels.find(row => row.id === sample.styleId && row.code === 'style')?.label;
  if ((sample.industryId && !industryLabel) || (sample.styleId && !styleLabel)) {
    return { ...validation, issues: [{ code: 'INVALID_SAMPLE_SCOPE', message: '示例行业或风格已不可用，请重新选择。' }], messages: [], directionPrompts: null, attachments: [] };
  }
  const brief = normalizeThemeInput({ industryId: sample.industryId ?? '', styleId: sample.styleId ?? '', brandColors: sample.brandColors ?? [], brandKeywords: sample.brandKeywords ?? '' });
  if (input.purpose === 'theme') return { ...validation,
    messages: [{ role: 'prompt', content: buildThemePrompt(brief, industryLabel ?? '示例行业', styleLabel ?? '示例风格', input.body) }], directionPrompts: null,
    attachments: ['真实执行：当前方案的原始效果图', '真实执行：该效果图的可用蒙版（如有）'] };
  const { directionPrompts } = buildArtworkPrompts(brief, industryLabel ?? '示例行业', styleLabel ?? '示例风格', input.body);
  return { ...validation, messages: [], directionPrompts, attachments: ['真实执行：用户选中的主题效果图资产版本，四个方向使用同一参考图'] };
}
