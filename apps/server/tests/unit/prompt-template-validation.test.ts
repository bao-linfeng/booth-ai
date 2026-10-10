import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPrompt, inspectPrompt, renderPrompt } from '../../src/modules/prompts/template.js';
import { buildArtworkPrompts } from '../../src/modules/generation/artwork/prompt.js';

test('prompt validation extracts supported variables and rejects unknown variables and empty bodies', () => {
  assert.deepEqual(inspectPrompt('theme', '{{industryLabel}} / {{brandColors}}'), {
    variables: ['industryLabel', 'brandColors'],
    issues: [],
  });
  assert.equal(inspectPrompt('filter', '').issues[0]?.code, 'EMPTY_BODY');
  assert.equal(inspectPrompt('theme', '{{unknown}}').issues[0]?.code, 'UNKNOWN_VARIABLE');
  assert.equal(inspectPrompt('theme', '{{brandColors}').issues[0]?.code, 'INVALID_VARIABLE');
  assert.equal(inspectPrompt('theme', '{{directionLabel}}').issues[0]?.code, 'UNKNOWN_VARIABLE');
  assert.throws(() => assertPrompt('artwork', '{{unknown}}'), { reason: 'INVALID_PROMPT_TEMPLATE' });
});

test('ordinary JSON with consecutive braces is not treated as a variable error', () => {
  const body = '返回 JSON：{"fields":{"value":1,"text":"普通对象"}}';
  assert.deepEqual(inspectPrompt('filter', body), { variables: [], issues: [] });
});

test('rendering replaces template tokens once and preserves variable-like user text', () => {
  const userText = '标语 {{styleLabel}}，不要递归替换';
  const rendered = renderPrompt('theme', '{{brandKeywords}}', { brandKeywords: userText });
  assert.equal(rendered, userText);
});

test('artwork user keywords are not recursively rendered while system direction instructions are expanded', () => {
  const result = buildArtworkPrompts(
    { industryId: 'industry', styleId: 'style', brandColors: [], brandKeywords: '{{directionLabel}} {{cameraInstructions}}' },
    '行业',
    '风格',
  );
  const left = result.directionPrompts.left;
  assert.match(left, /品牌关键词：\{\{directionLabel\}\} \{\{cameraInstructions\}\}/);
  assert.match(left, /【本次相机：左侧 \/ LEFT/);
  assert.doesNotMatch(left, /【本次相机：\{\{directionLabel\}\}/);
  assert.doesNotMatch(left, /运行时自动注入当前方向的相机和遮挡约束/);
});
