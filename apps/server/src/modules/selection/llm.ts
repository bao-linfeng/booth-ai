import { textAdapter } from '../../infra/ai/protocols.js';
import type { ActiveAiModel } from '../../infra/ai/types.js';
import { emptyRequirement, validateRequirement, type Catalog, type Requirement } from './domain.js';
import { DEFAULT_MESSAGE_LOCALE, message, type MessageLocale } from './messages/index.js';
import { parseRequirement } from './parse.js';
import { buildSelectionMessages } from './prompt.js';

type Field = keyof Requirement;

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
  if (content.length > 12000) throw new Error('Invalid model response');
  return JSON.parse(content) as unknown;
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
    raw.unhandledText.some(item => typeof item !== 'string' || !item.trim() || !text.includes(item)) ||
    Object.keys(raw.fields).length > 18
  )
    throw new Error('Invalid extraction');
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
      !entry.evidence.trim() ||
      !text.includes(entry.evidence)
    )
      throw new Error('Invalid extraction');
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
        throw new Error('Invalid extraction');
    } else if (Array.isArray(requirement[key])) {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 50 ||
        value.some(id => typeof id !== 'string' || !options.some(option => option.id === id)) ||
        new Set(value).size !== value.length
      )
        throw new Error('Invalid extraction');
    } else if (typeof value !== 'string' || !options.some(option => option.id === value)) throw new Error('Invalid extraction');
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
    throw new Error('Invalid extraction');
  }
  const unhandledText = [
    ...new Set([...parseRequirement(text, form, catalog, [...handled], locale).unhandledText, ...(raw.unhandledText as string[])]),
  ];
  if (unhandledText.length)
    clarifications.push({ field: 'text', reason: 'NEEDS_CONFIRMATION', question: message(locale, 'llmUnhandled'), candidates: [] });
  return {
    ...rules,
    status: clarifications.length ? 'needs_clarification' : 'ready',
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

export async function parseWithModels(
  text: string,
  form: Requirement,
  catalog: Catalog,
  models: ActiveAiModel[],
  extract: typeof requestExtraction = requestExtraction,
  templateBody?: string,
  locale: MessageLocale = DEFAULT_MESSAGE_LOCALE,
) {
  const deadline = Date.now() + 2800;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 200) return parseRequirement(text, form, catalog, [], locale);
      try {
        const raw = await extract(model, text, catalog, AbortSignal.timeout(Math.min(1800, remaining)), templateBody);
        return mergeExtraction(text, form, catalog, raw, locale);
      } catch {
        // A second attempt is bounded; the rule parser remains available when both models fail.
      }
    }
  }
  return parseRequirement(text, form, catalog, [], locale);
}
