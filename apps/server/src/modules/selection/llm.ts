import { textAdapter } from '../../infra/ai/protocols.js';
import type { ActiveAiModel } from '../../infra/ai/types.js';
import { emptyRequirement, validateRequirement, type Catalog, type Requirement } from './domain.js';
import { DEFAULT_MESSAGE_LOCALE, message, type MessageLocale } from './messages/index.js';
import { parseRequirement } from './parse.js';
import { buildSelectionMessages } from './prompt.js';

type Field = keyof Requirement;

/** 模型解析失败所在阶段，写入解析记录供后台定位降级原因 */
export type ExtractionFailure =
  | 'timeout'
  | 'provider_error'
  | 'invalid_json'
  | 'invalid_structure'
  | 'invalid_evidence'
  | 'invalid_value'
  | 'invalid_requirement';

export interface ExtractionAttempt {
  modelId: string;
  model: string;
  attempt: number;
  durationMs: number;
  outcome: 'ok' | ExtractionFailure;
  /** 供应商返回的 HTTP 状态码，仅 provider_error 时可能存在 */
  httpStatus?: number;
  /** 校验未通过的字段，仅字段级失败时存在 */
  field?: string;
}

export class ExtractionError extends Error {
  constructor(
    readonly stage: Exclude<ExtractionFailure, 'timeout' | 'provider_error'>,
    readonly field?: string,
  ) {
    super('Invalid extraction');
  }
}

export async function requestExtraction(
  model: ActiveAiModel,
  text: string,
  catalog: Catalog,
  signal: AbortSignal,
  templateBody?: string,
): Promise<unknown> {
  const content = await textAdapter(model).complete(model, {
    messages: buildSelectionMessages(text, catalog, templateBody),
    maxTokens: 2400,
    json: true,
    signal,
  });
  if (content.length > 12000) throw new ExtractionError('invalid_json');
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ExtractionError('invalid_json');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeExtraction(
  text: string,
  form: Requirement,
  catalog: Catalog,
  raw: unknown,
  locale: MessageLocale = DEFAULT_MESSAGE_LOCALE,
) {
  if (
    !isRecord(raw) ||
    !isRecord(raw.fields) ||
    !Array.isArray(raw.unhandledText) ||
    Object.keys(raw).some(key => !['fields', 'unhandledText'].includes(key)) ||
    raw.unhandledText.length > 20 ||
    raw.unhandledText.some(item => typeof item !== 'string' || !item.trim()) ||
    Object.keys(raw.fields).length > 18
  )
    throw new ExtractionError('invalid_structure');
  if (raw.unhandledText.some(item => !text.includes(item as string))) throw new ExtractionError('invalid_evidence', 'unhandledText');
  const rules = parseRequirement(text, form, catalog, [], locale);
  const requirement = structuredClone(rules.requirement);
  const fieldSources = { ...rules.fieldSources };
  const overrides = [...rules.overrides];
  const clarifications = rules.clarifications.filter(item => item.field !== 'text');
  const permitted = new Set<Field>(Object.keys(emptyRequirement()) as Field[]);
  const blocked = new Set(clarifications.map(item => item.field));
  const handled = new Set<string>();

  for (const [field, entry] of Object.entries(raw.fields)) {
    if (
      !permitted.has(field as Field) ||
      field === 'keywords' ||
      !isRecord(entry) ||
      Object.keys(entry).some(key => !['value', 'evidence'].includes(key)) ||
      typeof entry.evidence !== 'string' ||
      !entry.evidence.trim()
    )
      throw new ExtractionError('invalid_structure', field);
    if (!text.includes(entry.evidence)) throw new ExtractionError('invalid_evidence', field);
    const key = field as Field;
    const value = entry.value;
    const options =
      field === 'boothSpaceId'
        ? catalog.boothSpaces
        : field === 'productSystemId'
          ? catalog.productSystems
          : field === 'budgetTierId'
            ? catalog.budgetTiers
            : field === 'styleIds'
              ? catalog.styles
              : field === 'industryIds'
                ? catalog.industries
                : field.toLowerCase().includes('zone')
                  ? catalog.zones
                  : catalog.features;
    if (['lengthMm', 'widthMm', 'maxHeightMm', 'openingCount', 'areaM2'].includes(field)) {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > 1_000_000 ||
        (field !== 'areaM2' && !Number.isInteger(value)) ||
        (field === 'openingCount' && !catalog.openingCounts.some(option => option.id === String(value)))
      )
        throw new ExtractionError('invalid_value', field);
    } else if (Array.isArray(requirement[key])) {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 50 ||
        value.some(id => typeof id !== 'string' || !options.some(option => option.id === id)) ||
        new Set(value).size !== value.length
      )
        throw new ExtractionError('invalid_value', field);
    } else if (typeof value !== 'string' || !options.some(option => option.id === value)) throw new ExtractionError('invalid_value', field);
    if (blocked.has(field)) continue;
    const oppositeFields =
      field === 'zoneIds' || field === 'requiredZoneIds'
        ? ['excludedZoneIds']
        : field === 'featureIds' || field === 'requiredFeatureIds'
          ? ['excludedFeatureIds']
          : field === 'excludedZoneIds'
            ? ['zoneIds', 'requiredZoneIds']
            : field === 'excludedFeatureIds'
              ? ['featureIds', 'requiredFeatureIds']
              : [];
    if (
      Array.isArray(value) &&
      oppositeFields.some(
        opposite =>
          fieldSources[opposite]?.source === 'text' && (requirement[opposite as Field] as string[]).some(id => value.includes(id)),
      )
    ) {
      clarifications.push({ field, reason: 'NEEDS_CONFIRMATION', question: message(locale, 'llmOpposite'), candidates: [] });
      continue;
    }
    if (fieldSources[field]?.source === 'text') {
      const existing = requirement[key];
      const agrees =
        Array.isArray(existing) && Array.isArray(value)
          ? existing.every(id => value.includes(id))
          : JSON.stringify(existing) === JSON.stringify(value);
      if (!agrees) {
        clarifications.push({ field, reason: 'NEEDS_CONFIRMATION', question: message(locale, 'llmExisting'), candidates: [] });
        continue;
      }
    }
    const prefix =
      text
        .slice(Math.max(0, text.indexOf(entry.evidence) - 10), text.indexOf(entry.evidence))
        .split(/[，,。；;\n]/)
        .at(-1) ?? '';
    if (
      ['zoneIds', 'featureIds', 'requiredZoneIds', 'requiredFeatureIds'].includes(field) &&
      /(?:不要|不需要|禁止|不能有|不含|不能包含|无)\s*$/.test(prefix)
    ) {
      clarifications.push({ field, reason: 'NEEDS_CONFIRMATION', question: message(locale, 'llmNegation'), candidates: [] });
      continue;
    }
    if ((field === 'lengthMm' || field === 'widthMm') && requirement[key] !== value) requirement.boothSpaceId = null;
    if (JSON.stringify(requirement[key]) !== JSON.stringify(value))
      overrides.push({ field, previousValue: requirement[key], value, evidence: entry.evidence });
    (requirement as unknown as Record<string, unknown>)[key] = value;
    fieldSources[field] = { source: 'text', evidence: entry.evidence };
    handled.add(entry.evidence);
  }
  if (requirement.lengthMm && requirement.widthMm) {
    const area = (requirement.lengthMm * requirement.widthMm) / 1_000_000;
    if (fieldSources.areaM2?.source === 'text' && requirement.areaM2 !== null && Math.abs(requirement.areaM2 - area) > 0.000001) {
      clarifications.push({ field: 'areaM2', reason: 'NEEDS_CONFIRMATION', question: message(locale, 'llmAreaConflict'), candidates: [] });
    }
    requirement.areaM2 = area;
    fieldSources.areaM2 = { source: 'derived' };
  }
  try {
    Object.assign(requirement, validateRequirement(requirement, catalog));
  } catch {
    throw new ExtractionError('invalid_requirement');
  }
  // 规则已确定识别的片段（如“长宽 6*3”）不因模型更保守的判断再要求确认
  const ruleEvidence = Object.values(rules.fieldSources).flatMap(source =>
    source.source === 'text' && source.evidence ? [source.evidence] : [],
  );
  const modelUnhandled = (raw.unhandledText as string[]).filter(item => !ruleEvidence.some(evidence => evidence.includes(item)));
  const unhandledText = [...new Set([...parseRequirement(text, form, catalog, [...handled], locale).unhandledText, ...modelUnhandled])];
  if (unhandledText.length)
    clarifications.push({ field: 'text', reason: 'NEEDS_CONFIRMATION', question: message(locale, 'llmUnhandled'), candidates: [] });
  return {
    ...rules,
    status: clarifications.length ? ('needs_clarification' as const) : ('ready' as const),
    requirement,
    parser: 'llm',
    degraded: false,
    fieldSources,
    overrides,
    clarifications,
    unhandledText,
    warnings: [],
  };
}

/** 单次模型调用的超时；整轮解析（含换备用模型）不超过总预算，须小于 HTTP 请求超时（app.ts requestTimeout） */
const ATTEMPT_TIMEOUT_MS = 10_000;
const PARSE_BUDGET_MS = 20_000;

function failureOf(error: unknown): Pick<ExtractionAttempt, 'outcome' | 'httpStatus' | 'field'> {
  if (error instanceof ExtractionError) return { outcome: error.stage, ...(error.field ? { field: error.field } : {}) };
  const { name, status } = (error ?? {}) as { name?: unknown; status?: unknown };
  if (name === 'TimeoutError' || name === 'AbortError') return { outcome: 'timeout' };
  return { outcome: 'provider_error', ...(typeof status === 'number' ? { httpStatus: status } : {}) };
}

export async function parseWithModels(
  text: string,
  form: Requirement,
  catalog: Catalog,
  models: ActiveAiModel[],
  extract: typeof requestExtraction = requestExtraction,
  templateBody?: string,
  locale: MessageLocale = DEFAULT_MESSAGE_LOCALE,
) {
  const deadline = Date.now() + PARSE_BUDGET_MS;
  const attempts: ExtractionAttempt[] = [];
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 200) return { result: parseRequirement(text, form, catalog, [], locale), attempts };
      const startedAt = performance.now();
      const record = (outcome: Pick<ExtractionAttempt, 'outcome' | 'httpStatus' | 'field'>) =>
        attempts.push({
          modelId: model.id,
          model: model.model,
          attempt: attempt + 1,
          durationMs: Math.round(performance.now() - startedAt),
          ...outcome,
        });
      try {
        const raw = await extract(model, text, catalog, AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)), templateBody);
        const result = mergeExtraction(text, form, catalog, raw, locale);
        record({ outcome: 'ok' });
        return { result, attempts };
      } catch (error) {
        const failure = failureOf(error);
        record(failure);
        // 超时的模型立即重试多半仍会超时，直接换备用模型；全部失败时由规则解析兜底
        if (failure.outcome === 'timeout') break;
      }
    }
  }
  return { result: parseRequirement(text, form, catalog, [], locale), attempts };
}
