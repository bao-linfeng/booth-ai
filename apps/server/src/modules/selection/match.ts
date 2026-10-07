import { randomInt } from 'node:crypto';
import { DEFAULT_MESSAGE_LOCALE, message, type MessageKey, type MessageLocale } from './messages/index.js';
import { isEmpty, invalid, rulesVersion, type BoothSpace, type Candidate, type MatchDiagnostics, type MatchItem, type Requirement } from './domain.js';

type ExclusionKey = keyof MatchDiagnostics['exclusions'];
type FilterExclusionKey = 'productSystem' | 'height' | 'tags' | 'dimensions';
type Evaluation = { misses: Record<FilterExclusionKey, boolean>; deviation: number };
type RankedItem = { item: MatchItem; deviation: number; preference: number };
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const MAX_ITEMS = 3;
const MAX_DIMENSION_DEVIATION = 0.3;

const EXCLUSION_LABELS: Record<ExclusionKey, MessageKey> = {
  unverifiedChecklist: 'excUnverifiedChecklist', incompleteAssets: 'excIncompleteAssets', invalidData: 'excInvalidData',
  productSystem: 'excProductSystem', height: 'excHeight',
  tags: 'excTags', dimensions: 'excDimensions'
};
const POOL_EXCLUSIONS: ExclusionKey[] = ['unverifiedChecklist', 'incompleteAssets', 'invalidData'];

const intersects = (left: string[], right: string[]) => left.some(value => right.includes(value));

export function matchSchemes(candidates: Candidate[], requirement: Requirement, mode: 'random' | 'filtered', textProvided: boolean, poolDiagnostics?: MatchDiagnostics, boothSpaces: BoothSpace[] = [], locale: MessageLocale = DEFAULT_MESSAGE_LOCALE) {
  const selectedSize = requirement.boothSpaceId ? boothSpaces.find(space => space.id === requirement.boothSpaceId) : undefined;
  if (requirement.boothSpaceId && !selectedSize) invalid('Unknown booth size');
  if (mode === 'random' && (textProvided || !isEmpty(requirement))) invalid('Random requires empty input');

  const diagnostics = createDiagnostics(candidates, poolDiagnostics);
  const text: Translate = (key, params) => message(locale, key, params);
  const missingFields = findMissingFields(requirement, text);
  const base = { mode, requirement, missingFields, rulesVersion };

  if (mode === 'filtered' && isEmpty(requirement)) {
    return { ...base, status: 'needs_clarification', items: [], counts: { direct: 0, reference: 0, random: 0, total: 0 }, diagnostics, reasons: [text('matchNeedCondition')], suggestions: [] };
  }

  const items = mode === 'random'
    ? pickRandomItems(candidates, text)
    : rankCandidates(candidates, requirement, missingFields, diagnostics, text, selectedSize);

  const counts = {
    direct: items.filter(item => item.matchType === 'direct').length,
    reference: items.filter(item => item.matchType === 'reference').length,
    random: items.filter(item => item.matchType === 'random').length,
    total: items.length
  };

  return {
    ...base,
    status: items.length ? 'matched' : 'no_match',
    items,
    counts,
    diagnostics,
    reasons: !items.length
      ? buildNoMatchReasons(mode, diagnostics, text)
      : !counts.direct && mode === 'filtered'
      ? [text('matchNoDirect')]
      : [],
    suggestions: items.length ? [] : buildNoMatchSuggestions(diagnostics, text)
  };
}

function createDiagnostics(candidates: Candidate[], poolDiagnostics?: MatchDiagnostics): MatchDiagnostics {
  if (poolDiagnostics) return structuredClone(poolDiagnostics);
  return {
    reviewedPublished: candidates.length, ready: candidates.length,
    exclusions: { unverifiedChecklist: 0, incompleteAssets: 0, invalidData: 0, productSystem: 0, height: 0, tags: 0, dimensions: 0 }
  };
}

function findMissingFields(requirement: Requirement, text: Translate): string[] {
  return [
    !requirement.lengthMm && text('missingLength'),
    !requirement.widthMm && text('missingWidth'),
    !requirement.maxHeightMm && text('missingMaxHeight'),
    !requirement.openingCount && text('missingOpeningCount')
  ].filter((value): value is string => !!value);
}

function toItem(candidate: Candidate, matchType: MatchItem['matchType']): MatchItem {
  return {
    code: candidate.code,
    matchType,
    images: candidate.images,
    specifications: candidate.specifications,
    reasons: [],
    differences: [],
    pendingConfirmations: [],
    preferenceMisses: []
  };
}

// ---------- random ----------

function pickRandomItems(candidates: Candidate[], text: Translate): MatchItem[] {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, MAX_ITEMS).map(candidate => ({
    ...toItem(candidate, 'random'),
    pendingConfirmations: [{ type: 'missing_field', message: text('matchRandomPending') }]
  }));
}

// ---------- filtered ----------

function rankCandidates(candidates: Candidate[], requirement: Requirement, missingFields: string[], diagnostics: MatchDiagnostics, text: Translate, selectedSize?: BoothSpace): MatchItem[] {
  const ranked: RankedItem[] = [];

  for (const candidate of candidates) {
    const { misses, deviation } = evaluateCandidate(candidate, requirement, selectedSize);
    const missed = (Object.keys(misses) as FilterExclusionKey[]).filter(key => misses[key]);
    for (const key of missed) diagnostics.exclusions[key]++;
    if (missed.length) continue;

    const item = buildMatchItem(candidate, requirement, missingFields, text);
    const { score, misses: preferenceMisses } = scorePreferences(candidate, requirement, text);
    item.preferenceMisses = preferenceMisses;
    ranked.push({ item, deviation, preference: score });
  }

  return ranked.sort(compareRanked).slice(0, MAX_ITEMS).map(row => row.item);
}

/** 硬条件判定：所有命中的排除项都会被记录（原因可重叠），deviation 为尺寸/面积的最大相对偏差。 */
function evaluateCandidate(candidate: Candidate, requirement: Requirement, selectedSize?: BoothSpace): Evaluation {
  const s = candidate.specifications;
  const deviation = dimensionDeviation(candidate, requirement);
  return {
    deviation,
    misses: {
      productSystem: !!requirement.productSystemId && requirement.productSystemId !== s.productSystemId,
      height: !!requirement.maxHeightMm && s.heightMm > requirement.maxHeightMm,
      tags: hasTagMiss(candidate, requirement),
      dimensions: selectedSize ? s.lengthMm !== selectedSize.lengthMm || s.widthMm !== selectedSize.widthMm || s.heightMm !== selectedSize.heightMm
        : deviation > MAX_DIMENSION_DEVIATION + Number.EPSILON
    }
  };
}

function hasTagMiss(candidate: Candidate, requirement: Requirement): boolean {
  return requirement.requiredZoneIds.some(id => !candidate.zoneIds.includes(id))
    || requirement.requiredFeatureIds.some(id => !candidate.featureIds.includes(id))
    || intersects(requirement.excludedZoneIds, candidate.zoneIds)
    || intersects(requirement.excludedFeatureIds, candidate.featureIds);
}

function dimensionDeviation(candidate: Candidate, requirement: Requirement): number {
  const s = candidate.specifications;
  const deviations = [
    requirement.areaM2 && Math.abs(s.areaM2 - requirement.areaM2) / requirement.areaM2,
    requirement.lengthMm && Math.abs(s.lengthMm - requirement.lengthMm) / requirement.lengthMm,
    requirement.widthMm && Math.abs(s.widthMm - requirement.widthMm) / requirement.widthMm,
  ].filter((value): value is number => typeof value === 'number');
  return Math.max(0, ...deviations);
}

/** 通过硬条件的候选：生成差异、待确认项，并在无差异无待确认时升级为 direct。 */
function buildMatchItem(candidate: Candidate, requirement: Requirement, missingFields: string[], text: Translate): MatchItem {
  const item = toItem(candidate, 'reference');
  item.pendingConfirmations = missingFields.map(field => ({ type: 'missing_field' as const, field, message: text('pendingMissing', { field }) }));
  item.differences = buildDifferences(candidate, requirement, text);

  if (!item.differences.length && !item.pendingConfirmations.length) {
    item.matchType = 'direct';
    item.reasons = [text('reasonSize'), text('reasonHeight')];
  }
  return item;
}

function buildDifferences(candidate: Candidate, requirement: Requirement, text: Translate): MatchItem['differences'] {
  const s = candidate.specifications;
  const differences: MatchItem['differences'] = [];
  for (const [field, label] of [['lengthMm', text('lengthShort')], ['widthMm', text('widthShort')]] as const) {
    if (requirement[field] && requirement[field] !== s[field]) {
      differences.push({ field, requested: `${label} ${requirement[field]! / 1000} m`, actual: `${label} ${s[field] / 1000} m`, reason: text('diffSize') });
    }
  }
  if (requirement.areaM2 && requirement.areaM2 !== s.areaM2) {
    differences.push({ field: 'areaM2', requested: `${requirement.areaM2} ㎡`, actual: `${s.areaM2} ㎡`, reason: text('diffArea') });
  }
  if (requirement.openingCount && requirement.openingCount !== s.openingCount) {
    differences.push({ field: 'openingCount', requested: text('openingCount', { count: requirement.openingCount }), actual: text('openingCount', { count: s.openingCount }), reason: text('diffOpening') });
  }
  return differences;
}

function scorePreferences(candidate: Candidate, requirement: Requirement, text: Translate): { score: number; misses: string[] } {
  let score = 0;
  const misses: string[] = [];

  if (requirement.styleIds.length) {
    if (candidate.styleId && requirement.styleIds.includes(candidate.styleId)) score += 3;
    else misses.push(text('missStyle'));
  }
  if (requirement.industryIds.length) {
    if (intersects(requirement.industryIds, candidate.industryIds)) score += 2;
    else misses.push(text('missIndustry'));
  }
  if (requirement.budgetTierId) {
    if (requirement.budgetTierId === candidate.budgetTierId) score += 2;
    else misses.push(text('missBudget'));
  }

  score += Math.min(2, requirement.zoneIds.filter(id => candidate.zoneIds.includes(id)).length);
  score += Math.min(2, requirement.featureIds.filter(id => candidate.featureIds.includes(id)).length);
  score += Math.min(3, requirement.keywords.filter(word => candidate.keywords.includes(word) && !candidate.zoneIds.includes(word) && !candidate.featureIds.includes(word)).length);
  return { score, misses };
}

/** direct 优先 → 尺寸偏差小 → 待确认项少 → 偏好分高 → 方案编号。 */
function compareRanked(a: RankedItem, b: RankedItem): number {
  const aDirect = a.item.matchType === 'direct' ? 1 : 0;
  const bDirect = b.item.matchType === 'direct' ? 1 : 0;
  if (aDirect !== bDirect) return bDirect - aDirect;
  if (a.deviation !== b.deviation) return a.deviation - b.deviation;
  if (a.item.pendingConfirmations.length !== b.item.pendingConfirmations.length) return a.item.pendingConfirmations.length - b.item.pendingConfirmations.length;
  if (a.preference !== b.preference) return b.preference - a.preference;
  return a.item.code < b.item.code ? -1 : (a.item.code > b.item.code ? 1 : 0);
}

// ---------- no match ----------

function buildNoMatchReasons(mode: 'random' | 'filtered', diagnostics: MatchDiagnostics, text: Translate): string[] {
  if (!diagnostics.reviewedPublished) return [text('noPublished')];

  const order = Object.keys(EXCLUSION_LABELS) as ExclusionKey[];
  const orderedExclusions = order
    .filter(key => diagnostics.exclusions[key] > 0)
    .sort((a, b) => diagnostics.exclusions[b] - diagnostics.exclusions[a] || order.indexOf(a) - order.indexOf(b));

  return [
    mode === 'random' ? text('noMatchRandom') : text('noMatchFiltered'),
    ...orderedExclusions.map(key => text(POOL_EXCLUSIONS.includes(key) ? 'excPoolLine' : 'excAvailableLine', { label: text(EXCLUSION_LABELS[key]), count: diagnostics.exclusions[key] }))
  ];
}

function buildNoMatchSuggestions(diagnostics: MatchDiagnostics, text: Translate): string[] {
  return [
    ...(diagnostics.exclusions.dimensions ? [text('suggestDimensions')] : []),
    ...(diagnostics.exclusions.productSystem ? [text('suggestProductSystem')] : []),
    ...(diagnostics.exclusions.tags ? [text('suggestTags')] : []),
    text('suggestAdvisor')
  ];
}
