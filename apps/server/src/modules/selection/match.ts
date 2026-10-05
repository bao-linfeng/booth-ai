import { randomInt } from 'node:crypto';
import { isEmpty, invalid, rulesVersion, type ApplicabilityQuestionSummary, type BoothSpace, type Candidate, type MatchDiagnostics, type MatchItem, type PendingConfirmation, type Requirement } from './domain.js';

type ExclusionKey = keyof MatchDiagnostics['exclusions'];
type FilterExclusionKey = 'productSystem' | 'height' | 'applicability' | 'tags' | 'dimensions';
type Evaluation = { misses: Record<FilterExclusionKey, boolean>; deviation: number };
type RankedItem = { item: MatchItem; deviation: number; preference: number };

const MAX_ITEMS = 3;
const MAX_DIMENSION_DEVIATION = 0.3;

const EXCLUSION_LABELS: Record<ExclusionKey, string> = {
  unverifiedChecklist: '清单未核验', incompleteAssets: '资产不完整', invalidData: '基础数据或审核信息不完整',
  productSystem: '产品体系不符', height: '超过场馆限高', applicability: '适用条件不符',
  tags: '必选或禁用功能条件不符', dimensions: '尺寸不符或超出参考范围'
};
const POOL_EXCLUSIONS: ExclusionKey[] = ['unverifiedChecklist', 'incompleteAssets', 'invalidData'];

const intersects = (left: string[], right: string[]) => left.some(value => right.includes(value));

export function matchSchemes(candidates: Candidate[], requirement: Requirement, mode: 'random' | 'filtered', textProvided: boolean, poolDiagnostics?: MatchDiagnostics, applicabilityQuestions: ApplicabilityQuestionSummary[] = [], boothSpaces: BoothSpace[] = []) {
  const selectedSize = requirement.boothSpaceId ? boothSpaces.find(space => space.id === requirement.boothSpaceId) : undefined;
  if (requirement.boothSpaceId && !selectedSize) invalid('Unknown booth size');
  if (mode === 'random' && (textProvided || !isEmpty(requirement))) invalid('Random requires empty input');

  const diagnostics = createDiagnostics(candidates, poolDiagnostics);
  const missingFields = findMissingFields(requirement);
  const base = { mode, requirement, missingFields, rulesVersion };

  if (mode === 'filtered' && isEmpty(requirement)) {
    return { ...base, status: 'needs_clarification', items: [], counts: { direct: 0, reference: 0, random: 0, total: 0 }, diagnostics, reasons: ['请至少提供一项可识别的条件'], suggestions: [] };
  }

  const items = mode === 'random'
    ? pickRandomItems(candidates)
    : rankCandidates(candidates, requirement, missingFields, applicabilityQuestions, diagnostics, selectedSize);

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
      ? buildNoMatchReasons(mode, diagnostics)
      : !counts.direct && mode === 'filtered'
      ? ['未找到可直接采用方案，以下仅供参考']
      : [],
    suggestions: items.length ? [] : buildNoMatchSuggestions(diagnostics)
  };
}

function createDiagnostics(candidates: Candidate[], poolDiagnostics?: MatchDiagnostics): MatchDiagnostics {
  if (poolDiagnostics) return structuredClone(poolDiagnostics);
  return {
    reviewedPublished: candidates.length, ready: candidates.length,
    exclusions: { unverifiedChecklist: 0, incompleteAssets: 0, invalidData: 0, productSystem: 0, height: 0, applicability: 0, tags: 0, dimensions: 0 }
  };
}

function findMissingFields(requirement: Requirement): string[] {
  return [
    !requirement.lengthMm && '展位长',
    !requirement.widthMm && '展位宽',
    !requirement.maxHeightMm && '场馆限高',
    !requirement.openingCount && '开口面数'
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

function pickRandomItems(candidates: Candidate[]): MatchItem[] {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, MAX_ITEMS).map(candidate => ({
    ...toItem(candidate, 'random'),
    pendingConfirmations: [{ type: 'missing_field', message: '随机推荐，尺寸、开口面数、限高及适用条件待确认' }]
  }));
}

// ---------- filtered ----------

function rankCandidates(candidates: Candidate[], requirement: Requirement, missingFields: string[], questions: ApplicabilityQuestionSummary[], diagnostics: MatchDiagnostics, selectedSize?: BoothSpace): MatchItem[] {
  const ranked: RankedItem[] = [];

  for (const candidate of candidates) {
    const { misses, deviation } = evaluateCandidate(candidate, requirement, selectedSize);
    const missed = (Object.keys(misses) as FilterExclusionKey[]).filter(key => misses[key]);
    for (const key of missed) diagnostics.exclusions[key]++;
    if (missed.length) continue;

    const item = buildMatchItem(candidate, requirement, missingFields, questions);
    const { score, misses: preferenceMisses } = scorePreferences(candidate, requirement);
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
      applicability: candidate.applicabilityRules.some(rule => requirement.applicabilityAnswers[rule.id] !== undefined && requirement.applicabilityAnswers[rule.id] !== rule.expectedValue),
      tags: hasTagMiss(candidate, requirement),
      dimensions: selectedSize ? s.lengthMm !== selectedSize.lengthMm || s.widthMm !== selectedSize.widthMm || s.heightMm !== selectedSize.heightMm
        : deviation > MAX_DIMENSION_DEVIATION + Number.EPSILON
    }
  };
}

function hasTagMiss(candidate: Candidate, requirement: Requirement): boolean {
  const hasTagRequirement = requirement.requiredZoneIds.length > 0 || requirement.requiredFeatureIds.length > 0
    || requirement.excludedZoneIds.length > 0 || requirement.excludedFeatureIds.length > 0;
  return (hasTagRequirement && !candidate.labelsConfirmed)
    || requirement.requiredZoneIds.some(id => !candidate.zoneIds.includes(id))
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
function buildMatchItem(candidate: Candidate, requirement: Requirement, missingFields: string[], questions: ApplicabilityQuestionSummary[]): MatchItem {
  const item = toItem(candidate, 'reference');
  item.pendingConfirmations = buildPendingConfirmations(candidate, requirement, missingFields, questions);
  item.differences = buildDifferences(candidate, requirement);

  if (!item.differences.length && !item.pendingConfirmations.length) {
    item.matchType = 'direct';
    item.reasons = ['长宽、开口与已提供结构条件一致', '方案实际高度未超过场馆限高', '所需适用条件已确认'];
  }
  return item;
}

function buildPendingConfirmations(candidate: Candidate, requirement: Requirement, missingFields: string[], questions: ApplicabilityQuestionSummary[]): PendingConfirmation[] {
  const pending: PendingConfirmation[] = missingFields.map(field => ({ type: 'missing_field' as const, field, message: `需补充${field}` }));
  for (const rule of candidate.applicabilityRules) {
    if (requirement.applicabilityAnswers[rule.id] !== undefined) continue;
    const question = questions.find(q => q.id === rule.id);
    pending.push({
      type: 'applicability_question',
      id: rule.id,
      label: question?.label,
      helpText: question?.helpText,
      message: question ? `需确认：${question.label}` : `需确认适用条件：${rule.id}`,
    });
  }
  return pending;
}

function buildDifferences(candidate: Candidate, requirement: Requirement): MatchItem['differences'] {
  const s = candidate.specifications;
  const differences: MatchItem['differences'] = [];
  for (const [field, label] of [['lengthMm', '长'], ['widthMm', '宽']] as const) {
    if (requirement[field] && requirement[field] !== s[field]) {
      differences.push({ field, requested: `${label} ${requirement[field]! / 1000} m`, actual: `${label} ${s[field] / 1000} m`, reason: '尺寸不同，需重新设计并核验，不可直接施工' });
    }
  }
  if (requirement.areaM2 && requirement.areaM2 !== s.areaM2) {
    differences.push({ field: 'areaM2', requested: `${requirement.areaM2} ㎡`, actual: `${s.areaM2} ㎡`, reason: '面积与所需条件不同' });
  }
  if (requirement.openingCount && requirement.openingCount !== s.openingCount) {
    differences.push({ field: 'openingCount', requested: `${requirement.openingCount} 面`, actual: `${s.openingCount} 面`, reason: '开口数不同，需重新设计并核验' });
  }
  return differences;
}

function scorePreferences(candidate: Candidate, requirement: Requirement): { score: number; misses: string[] } {
  let score = 0;
  const misses: string[] = [];

  if (requirement.styleIds.length) {
    if (candidate.styleId && requirement.styleIds.includes(candidate.styleId)) score += 3;
    else misses.push('风格未命中所选偏好');
  }
  if (requirement.industryIds.length) {
    if (intersects(requirement.industryIds, candidate.industryIds)) score += 2;
    else misses.push('行业未命中所选偏好');
  }
  if (requirement.budgetTierId) {
    if (requirement.budgetTierId === candidate.budgetTierId) score += 2;
    else misses.push('材料购买预算档位与偏好不同');
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

function buildNoMatchReasons(mode: 'random' | 'filtered', diagnostics: MatchDiagnostics): string[] {
  if (!diagnostics.reviewedPublished) return ['当前暂无已发布且审核有效的方案'];

  const order = Object.keys(EXCLUSION_LABELS) as ExclusionKey[];
  const orderedExclusions = order
    .filter(key => diagnostics.exclusions[key] > 0)
    .sort((a, b) => diagnostics.exclusions[b] - diagnostics.exclusions[a] || order.indexOf(a) - order.indexOf(b));

  return [
    mode === 'random' ? '当前暂无可随机推荐的方案（各排除原因可重叠）' : '当前条件组合暂无可采用或参考的方案（各排除原因可重叠）',
    ...orderedExclusions.map(key => `${EXCLUSION_LABELS[key]}：${diagnostics.exclusions[key]} 套${POOL_EXCLUSIONS.includes(key) ? '已发布方案' : '可用方案'}`)
  ];
}

function buildNoMatchSuggestions(diagnostics: MatchDiagnostics): string[] {
  return [
    ...(diagnostics.exclusions.dimensions ? ['可检查所选长宽高尺寸，或调整自定义长宽与面积后重新查询'] : []),
    ...(diagnostics.exclusions.productSystem ? ['可检查所选产品体系，修改后重新查询'] : []),
    ...(diagnostics.exclusions.tags ? ['可检查必选或禁用的功能条件，修改后重新查询'] : []),
    '也可联系专业顾问确认可用方案'
  ];
}
