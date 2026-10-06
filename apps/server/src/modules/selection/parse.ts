import { emptyRequirement, rulesVersion, type Catalog, type Option, type Requirement } from './domain.js';
import { dictionaryTerms, normalizeDictionaryTerm } from './dictionary-language.js';
import { DEFAULT_MESSAGE_LOCALE, message, type MessageKey, type MessageLocale } from './messages/index.js';

type FieldSource = { source: 'form' | 'text' | 'derived'; evidence?: string };
type Override = { field: string; previousValue: unknown; value: unknown; evidence: string };
type Clarification = { field: string; reason: string; question: string; candidates: string[] };

/** 单次解析的共享状态与写入入口；各规则函数只通过它修改结果，执行顺序由 parseRequirement 决定。 */
interface ParseContext {
  text: string;
  requirement: Requirement;
  fieldSources: Record<string, FieldSource>;
  overrides: Override[];
  clarifications: Clarification[];
  consumed: [number, number][];
  set<K extends keyof Requirement>(field: K, value: Requirement[K], evidence: string): void;
  consume(match: RegExpMatchArray): void;
  consumeRange(start: number, end: number): void;
  clarify(field: string, question: string): void;
  /** 按请求语言取文案。 */
  t(key: MessageKey, params?: Record<string, string | number>): string;
}

function createContext(text: string, form: Requirement, locale: MessageLocale): ParseContext {
  const requirement = structuredClone(form);
  const fieldSources: Record<string, FieldSource> = {};
  const overrides: Override[] = [];
  const clarifications: Clarification[] = [];
  const consumed: [number, number][] = [];

  for (const field of Object.keys(emptyRequirement())) {
    fieldSources[field] = { source: 'form' };
  }

  return {
    text: text.trim(),
    requirement, fieldSources, overrides, clarifications, consumed,
    set(field, value, evidence) {
      if ((field === 'lengthMm' || field === 'widthMm') && requirement[field] !== value) requirement.boothSpaceId = null;
      if (JSON.stringify(requirement[field]) !== JSON.stringify(value)) {
        overrides.push({ field, previousValue: requirement[field], value, evidence });
      }
      requirement[field] = value;
      fieldSources[field] = { source: 'text', evidence };
    },
    consume: match => consumed.push([match.index!, match.index! + match[0].length]),
    consumeRange: (start, end) => consumed.push([start, end]),
    clarify: (field, question) => clarifications.push({ field, reason: 'NEEDS_CONFIRMATION', question, candidates: [] }),
    t: (key, params) => message(locale, key, params)
  };
}

export function parseRequirement(text: string, form: Requirement, catalog: Catalog, recognizedEvidence: string[] = [], locale: MessageLocale = DEFAULT_MESSAGE_LOCALE) {
  const ctx = createContext(text, form, locale);

  parseDimensions(ctx);
  parseBoothSize(ctx, catalog);
  const areaMentioned = parseArea(ctx);
  flagAmbiguousDimensions(ctx);
  parseOpenings(ctx);
  parseDictionaries(ctx, catalog);
  deriveArea(ctx, areaMentioned);
  checkRequiredExcludedConflict(ctx);
  consumeRecognizedEvidence(ctx, recognizedEvidence);

  const unhandledText = findUnhandledText(ctx);
  if (unhandledText.length) {
    ctx.clarify('text', ctx.t('parseUnhandledRules'));
  }
  if (!ctx.consumed.length && ctx.text) {
    ctx.clarify('text', ctx.t('parseNoReliable'));
  }

  return {
    status: ctx.clarifications.length ? 'needs_clarification' : 'ready',
    requirement: ctx.requirement,
    parser: 'rules',
    degraded: true,
    fieldSources: ctx.fieldSources,
    overrides: ctx.overrides,
    clarifications: ctx.clarifications,
    unhandledText,
    warnings: [{ code: 'RULES_ONLY', message: ctx.t('parseWarningRulesOnly') }],
    rulesVersion
  };
}

// ---------- 尺寸 / 面积 / 开口 ----------

function parseDimensions(ctx: ParseContext) {
  for (const [field, label] of [['lengthMm', '(?:(?:展位)?长(?:度)?|\\blength|長さ|間口)'], ['widthMm', '(?:(?:展位)?宽(?:度)?|\\bwidth|奥行き)'], ['maxHeightMm', '(?:(?:场馆)?限高|\\b(?:max(?:imum)? height|height limit)|高さ制限|制限高さ)']] as const) {
    const matches = [...ctx.text.matchAll(new RegExp(`${label}\\s*(?:为|是|改为|改成|is|=|:|：|は)?\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|厘米|mm|cm|米|meters?|metres?|メートル|m)(?![a-z])`, 'gi'))];
    const values = matches.map(match => Number(match[1]) * (/毫米|mm/i.test(match[2]!) ? 1 : /厘米|cm/i.test(match[2]!) ? 10 : 1000));

    if (new Set(values).size > 1) {
      ctx.clarify(field, ctx.t('parseDimMultiple'));
    } else if (matches[0]) {
      const value = values[0]!;
      if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) {
        ctx.clarify(field, ctx.t('parseDimInvalid'));
      } else {
        ctx.set(field, value, matches[0][0]);
      }
    }
    matches.forEach(ctx.consume);
  }
}

function parseBoothSize(ctx: ParseContext, catalog: Catalog): void {
  const matches = [...ctx.text.matchAll(/(?:方案高(?:度)?|(?<!限)(?<!度)高(?:度)?|\bheight|高さ)\s*(?:为|是|is|=|:|：|は)?\s*(\d+(?:\.\d+)?)\s*(毫米|厘米|mm|cm|米|meters?|metres?|メートル|m)(?![a-z])/gi)]
    .filter(match => !ctx.consumed.some(([start, end]) => match.index! < end && match.index! + match[0].length > start));
  if (!matches.length) return;
  const heights = [...new Set(matches.map(match => Number(match[1]) * (/毫米|mm/i.test(match[2]!) ? 1 : /厘米|cm/i.test(match[2]!) ? 10 : 1000)))];
  if (ctx.fieldSources.lengthMm?.source !== 'text' || ctx.fieldSources.widthMm?.source !== 'text' || heights.length !== 1) {
    ctx.clarify('boothSpaceId', ctx.t('parseHeightNeedsSize'));
  } else {
    const size = catalog.boothSpaces.find(space => space.lengthMm === ctx.requirement.lengthMm && space.widthMm === ctx.requirement.widthMm && space.heightMm === heights[0]);
    if (size) ctx.set('boothSpaceId', size.id, matches[0]![0]);
    else ctx.clarify('boothSpaceId', ctx.t('parseHeightNoSize'));
  }
  matches.forEach(ctx.consume);
}

/** @returns 原文是否出现过面积表述，供后续与长宽乘积做冲突校验。 */
function parseArea(ctx: ParseContext): boolean {
  const matches = [...ctx.text.matchAll(/(?:面积\s*(?:为|是|=|：)?\s*)?(\d+(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²)/gi)];
  if (new Set(matches.map(match => Number(match[1]))).size > 1) {
    ctx.clarify('areaM2', ctx.t('parseAreaMultiple'));
  } else if (matches[0]) {
    ctx.set('areaM2', Number(matches[0][1]), matches[0][0]);
  }
  matches.forEach(ctx.consume);
  return matches.length > 0;
}

/** “6×3”这类没有标明方向的长宽，只提示确认，不自行赋值。 */
function flagAmbiguousDimensions(ctx: ParseContext) {
  for (const match of ctx.text.matchAll(/\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?(?:\s*(?:米|m))?/g)) {
    ctx.clarify('lengthMm', ctx.t('parseDirection', { text: match[0] }));
    ctx.consume(match);
  }
}

const OPENING_NUMERALS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 };

function parseOpenings(ctx: ParseContext) {
  const matches = [...ctx.text.matchAll(/([一二三四1234两])\s*面(?:开口)?|岛式/g)];
  const counts = matches.map(match => match[0] === '岛式' ? 4 : OPENING_NUMERALS[match[1]!] ?? Number(match[1]));

  if (new Set(counts).size > 1) {
    ctx.clarify('openingCount', ctx.t('parseOpeningConflict'));
  } else if (matches[0]) {
    ctx.set('openingCount', counts[0]!, matches[0][0]);
  }
  matches.forEach(ctx.consume);
}

// ---------- 字典词（含否定词 / 强约束） ----------

type DictionaryField = 'productSystemId' | 'styleIds' | 'industryIds' | 'budgetTierId' | 'zoneIds' | 'featureIds';
type DictionaryHits = { found: string[]; required: string[]; excluded: string[] };

const NEGATIVE_PREFIX = /(?:不要|不需要|禁止|不能有|不含|不能包含|无|\bno|\bwithout|\bexclude|\b(?:do not|don't)\s+(?:want|need|include))\s*$/i;
const STRONG_PREFIX = /(?:必须|务必|一定要)(?:有|包含|带)?\s*$|\b(?:must have|must include|required)\s*$/i;

function parseDictionaries(ctx: ParseContext, catalog: Catalog) {
  for (const [field, options] of [
    ['productSystemId', catalog.productSystems],
    ['styleIds', catalog.styles],
    ['industryIds', catalog.industries],
    ['budgetTierId', catalog.budgetTiers],
    ['zoneIds', catalog.zones],
    ['featureIds', catalog.features]
  ] as const) {
    const hits = scanDictionary(ctx, field, options);
    applyDictionaryHits(ctx, field, hits);
  }
}

function scanDictionary(ctx: ParseContext, field: DictionaryField, options: Option[]): DictionaryHits {
  const hits: DictionaryHits = { found: [], required: [], excluded: [] };
  const supportsTagConstraints = field === 'zoneIds' || field === 'featureIds';
  let normalized = '';
  const offsets: { start: number; end: number }[] = [];
  let offset = 0;
  for (const char of ctx.text) {
    const value = char.normalize('NFKC').toLowerCase();
    for (let index = 0; index < value.length; index++) {
      const current = /\s/u.test(value[index]!) ? ' ' : value[index]!;
      if (current === ' ' && normalized.endsWith(' ')) offsets[offsets.length - 1]!.end = offset + char.length;
      else {
        normalized += current;
        offsets.push({ start: offset, end: offset + char.length });
      }
    }
    offset += char.length;
  }
  const matches: { start: number; end: number; id: string }[] = [];
  for (const option of options) for (const term of dictionaryTerms(option)) {
    const word = normalizeDictionaryTerm(term);
    if (!word) continue;
    const isName = [option.label, ...Object.values(option.labels ?? {}), ...(option.aliases ?? []).map(alias => alias.text)]
      .some(name => normalizeDictionaryTerm(name) === word);
    if (!isName && normalizeDictionaryTerm(ctx.text) !== word) continue;
    let start = 0;
    while (start < normalized.length) {
      const index = normalized.indexOf(word, start);
      if (index < 0) break;
      start = index + word.length;
      if ((/^[a-z0-9]/i.test(word) && /[a-z0-9_]/i.test(normalized[index - 1] ?? ''))
        || (/[a-z0-9]$/i.test(word) && /[a-z0-9_]/i.test(normalized[start] ?? ''))) continue;
      matches.push({ start: offsets[index]!.start, end: offsets[start - 1]!.end, id: option.id });
    }
  }
  const ordered = matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted: typeof matches = [];
  for (const match of ordered) {
    if (accepted.some(other => other.start <= match.start && other.end >= match.end && (other.start !== match.start || other.end !== match.end))) continue;
    accepted.push(match);
  }
  for (const match of accepted) {
    const same = accepted.filter(other => other.start === match.start && other.end === match.end);
    if (new Set(same.map(other => other.id)).size > 1) {
      ctx.clarify(field, ctx.t('parseCandidates', { text: ctx.text.slice(match.start, match.end) }));
      ctx.consumeRange(match.start, match.end);
      continue;
    }
    const prefix = ctx.text.slice(Math.max(0, match.start - 40), match.start).split(/[，,。；;]/).at(-1) ?? '';
    const suffix = ctx.text.slice(match.end).split(/[，,。；;]/)[0] ?? '';
    const negative = NEGATIVE_PREFIX.test(prefix) || /^(?:は|が|を)?\s*(?:不要|必要ない|いらない|なし)/u.test(suffix);
    const strong = STRONG_PREFIX.test(prefix) || /^(?:は|が)?\s*必須/u.test(suffix);
    if (supportsTagConstraints) (negative ? hits.excluded : strong ? hits.required : hits.found).push(match.id);
    else if (negative || strong) ctx.clarify(field, ctx.t('parseNoConstraints'));
    else hits.found.push(match.id);
    ctx.consumeRange(match.start, match.end);
  }
  return hits;
}

function applyDictionaryHits(ctx: ParseContext, field: DictionaryField, { found, required, excluded }: DictionaryHits) {
  if (found.length) {
    const unique = [...new Set(found)];
    if (field === 'productSystemId' || field === 'budgetTierId') {
      if (unique.length > 1) ctx.clarify(field, ctx.t('parseMultiSingle'));
      else ctx.set(field, unique[0]!, ctx.t('evidenceDictionary'));
    } else {
      ctx.set(field, unique, ctx.t('evidenceDictionary'));
    }
  }

  if (field === 'zoneIds' || field === 'featureIds') {
    if (required.length) ctx.set(field === 'zoneIds' ? 'requiredZoneIds' : 'requiredFeatureIds', [...new Set(required)], ctx.t('evidenceRequired'));
    if (excluded.length) ctx.set(field === 'zoneIds' ? 'excludedZoneIds' : 'excludedFeatureIds', [...new Set(excluded)], ctx.t('evidenceExcluded'));
  }
}

// ---------- 跨字段校验 ----------

function deriveArea(ctx: ParseContext, areaMentioned: boolean) {
  const { requirement } = ctx;
  if (!requirement.lengthMm || !requirement.widthMm) return;

  const area = requirement.lengthMm * requirement.widthMm / 1_000_000;
  if (areaMentioned && requirement.areaM2 !== area) {
    ctx.clarify('areaM2', ctx.t('parseAreaTextConflict'));
  }
  requirement.areaM2 = area;
  ctx.fieldSources.areaM2 = { source: 'derived' };
}

function checkRequiredExcludedConflict(ctx: ParseContext) {
  const { requirement } = ctx;
  if (requirement.requiredZoneIds.some(id => requirement.excludedZoneIds.includes(id)) || requirement.requiredFeatureIds.some(id => requirement.excludedFeatureIds.includes(id))) {
    ctx.clarify('keywords', ctx.t('parseKeywordConflict'));
  }
}

// ---------- 未识别文本 ----------

const FILLER_ONLY = /^(?:的|展台|展位|风格|行业|开口|需要|有|和|与|及|想要|希望|必须|不要|不需要|带|一个|一点|简洁|改成|改为|\s)+$/;

/** 外部（如 LLM）已识别的证据片段同样视为已消费。 */
function consumeRecognizedEvidence(ctx: ParseContext, recognizedEvidence: string[]) {
  for (const evidence of recognizedEvidence) {
    let start = 0;
    while (start < ctx.text.length) {
      const index = ctx.text.indexOf(evidence, start);
      if (index < 0 || !evidence.length) break;
      ctx.consumeRange(index, index + evidence.length);
      start = index + evidence.length;
    }
  }
}

function findUnhandledText(ctx: ParseContext): string[] {
  const remainder = ctx.text.split('').map((char, index) => ctx.consumed.some(([start, end]) => index >= start && index < end) ? ' ' : char).join('');
  return remainder.split(/[，,。；;\n]/).map(value => value.trim()).filter(value => value && !FILLER_ONLY.test(value));
}
