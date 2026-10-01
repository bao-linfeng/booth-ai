export const PROMPT_PURPOSES = ['filter', 'theme', 'artwork'] as const;
export type PromptPurpose = typeof PROMPT_PURPOSES[number];
export const PROMPT_DEFAULT_VERSION = 1;

export const promptVariables = {
  filter: [],
  theme: ['industryLabel', 'styleLabel', 'brandColors', 'brandKeywords'],
  artwork: ['industryLabel', 'styleLabel', 'brandColors', 'brandKeywords', 'directionLabel'],
} satisfies Record<PromptPurpose, string[]>;

export interface PromptIssue { code: string; message: string; variable?: string; offset?: number }

export function inspectPrompt(purpose: PromptPurpose, body: string): { variables: string[]; issues: PromptIssue[] } {
  const issues: PromptIssue[] = [];
  if (!body.trim()) issues.push({ code: 'EMPTY_BODY', message: '请填写业务提示词正文。' });
  if (body.length > 30000) issues.push({ code: 'BODY_TOO_LONG', message: '提示词正文不能超过 30000 字符。' });
  const variables = new Set<string>();
  const token = /{{([^{}]*)}}/g;
  const ranges: { start: number; end: number }[] = [];
  for (const match of body.matchAll(token)) {
    const variable = match[1]!.trim();
    ranges.push({ start: match.index, end: match.index + match[0].length });
    if (!(promptVariables[purpose] as readonly string[]).includes(variable)) {
      issues.push({ code: 'UNKNOWN_VARIABLE', message: `当前用途不支持变量 {{${variable}}}。`, variable, offset: match.index });
    } else variables.add(variable);
  }
  for (const match of body.matchAll(/{{/g)) {
    if (!ranges.some(range => match.index >= range.start && match.index < range.end)) {
      issues.push({ code: 'INVALID_VARIABLE', message: '变量格式应为 {{变量名}}。', offset: match.index });
    }
  }
  return { variables: [...variables], issues };
}

export function assertPrompt(purpose: PromptPurpose, body: string): string[] {
  const { variables, issues } = inspectPrompt(purpose, body);
  if (issues.length) throw Object.assign(new Error('Invalid prompt template'), { statusCode: 400, reason: 'INVALID_PROMPT_TEMPLATE', issues });
  return variables;
}

export function renderPrompt(purpose: PromptPurpose, body: string, values: Record<string, string>): string {
  assertPrompt(purpose, body);
  return body.replace(/{{([^{}]*)}}/g, (_match, name: string) => {
    const value = values[name.trim()];
    if (value === undefined) throw new Error(`Missing prompt value: ${name.trim()}`);
    return value;
  }).trim();
}
