import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThemePrompt } from '../src/modules/client/theme-jobs/prompt.js';

const input = { industryId: 'industry-id', styleId: 'style-id', brandColors: ['#123456', '#ABCDEF'],
  brandKeywords: '灵通新能源，主墙展示储能产品，不要树叶，标语“绿色未来”' };

test('theme prompt carries explicit requirements and ordered colors with structure constraints', () => {
  const prompt = buildThemePrompt(input, '新能源', '极简');
  const requirements = JSON.parse(prompt.split('\n')[2]!);
  assert.deepEqual(requirements, { 行业: '新能源', 风格: '极简', 品牌色: '#123456, #ABCDEF', 品牌关键词及补充要求: input.brandKeywords });
  assert.match(prompt, /第一个为主色/);
  assert.match(prompt, /用户明确指定的用途和比例优先/);
  assert.match(prompt, /“不出现\/不要”等限制逐项落实/);
  assert.match(prompt, /相机角度、透视、构图/);
  assert.match(prompt, /提供蒙版时仅编辑蒙版允许的区域/);
  assert.doesNotMatch(prompt, /industry-id|style-id|模板补充/);
});

test('missing optional requirements have explicit fallbacks for omitted and empty values', () => {
  const prompt = buildThemePrompt({ industryId: 'i', styleId: 's' }, '医疗', '现代');
  assert.equal(prompt, buildThemePrompt({ industryId: 'i', styleId: 's', brandColors: [], brandKeywords: '  ' }, '医疗', '现代'));
  assert.equal(JSON.parse(prompt.split('\n')[2]!).品牌色, '未指定');
  assert.equal(JSON.parse(prompt.split('\n')[2]!).品牌关键词及补充要求, '未填写');
  assert.match(prompt, /未指定品牌色：优先执行补充要求中的配色/);
  assert.doesNotMatch(prompt, /undefined|null|第一个为主色/);
});

test('templates cannot omit the user brief and variable-like user text is not expanded recursively', () => {
  const keywords = '标语为“{{styleLabel}}”，不要红色';
  const prompt = buildThemePrompt({ ...input, brandKeywords: keywords }, '新能源', '极简',
    '{{industryLabel}}/{{styleLabel}}/{{brandColors}}/{{brandKeywords}}');
  assert.ok(prompt.includes(`新能源/极简/#123456, #ABCDEF/${keywords}`));
  assert.equal(JSON.parse(prompt.split('\n')[2]!).品牌关键词及补充要求, keywords);
  const noVariables = buildThemePrompt(input, '新能源', '极简', '采用有层次的平面构成');
  assert.ok(noVariables.includes(input.brandKeywords));
  assert.ok(noVariables.includes('#123456, #ABCDEF'));
  assert.match(noVariables, /采用有层次的平面构成/);
  assert.match(noVariables, /用户明确的展示要求和禁用要求优先于模板/);
});
