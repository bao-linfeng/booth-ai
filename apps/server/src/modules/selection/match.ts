import { randomInt } from 'node:crypto';
import { isEmpty, invalid, rulesVersion, type Candidate, type MatchDiagnostics, type MatchItem, type PendingConfirmation, type Requirement } from './domain.js';

const intersects = (left: string[], right: string[]) => left.some(value => right.includes(value));

export function matchSchemes(candidates: Candidate[], requirement: Requirement, mode: 'random' | 'filtered', textProvided: boolean, poolDiagnostics?: MatchDiagnostics, applicabilityQuestions: { id: string; label: string; helpText: string }[] = []) {
  if (mode === 'random' && (textProvided || !isEmpty(requirement))) invalid('Random requires empty input');

  const diagnostics: MatchDiagnostics = poolDiagnostics ? structuredClone(poolDiagnostics) : {
    reviewedPublished: candidates.length, ready: candidates.length,
    exclusions: { unverifiedChecklist: 0, incompleteAssets: 0, invalidData: 0, productSystem: 0, height: 0, applicability: 0, tags: 0, dimensions: 0 }
  };
  
  const missingFields = [
    !requirement.lengthMm && '展位长',
    !requirement.widthMm && '展位宽',
    !requirement.maxHeightMm && '场馆限高',
    !requirement.openingCount && '开口面数'
  ].filter((value): value is string => !!value);
  
  const base = { mode, requirement, missingFields, rulesVersion };
  
  if (mode === 'filtered' && isEmpty(requirement)) {
    return { ...base, status: 'needs_clarification', items: [], counts: { direct: 0, reference: 0, random: 0, total: 0 }, diagnostics, reasons: ['请至少提供一项可识别的条件'], suggestions: [] };
  }
  
  const toItem = (candidate: Candidate, matchType: MatchItem['matchType']): MatchItem => ({
    code: candidate.code,
    matchType,
    images: candidate.images,
    specifications: candidate.specifications,
    reasons: [],
    differences: [],
    pendingConfirmations: [],
    preferenceMisses: []
  });
  
  let items: MatchItem[];
  
  if (mode === 'random') {
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    items = shuffled.slice(0, 3).map(candidate => ({
      ...toItem(candidate, 'random'),
      pendingConfirmations: [{ type: 'missing_field', message: '随机推荐，尺寸、开口面数、限高及适用条件待确认' }]
    }));
  } else {
    const ranked: { item: MatchItem; deviation: number; preference: number }[] = [];
    
    for (const candidate of candidates) {
      const s = candidate.specifications;
      
      const systemMiss = !!requirement.productSystemId && requirement.productSystemId !== s.productSystemId;
      const heightMiss = !!requirement.maxHeightMm && s.heightMm > requirement.maxHeightMm;
      const applicabilityMiss = candidate.applicabilityRules.some(rule => requirement.applicabilityAnswers[rule.id] !== undefined && requirement.applicabilityAnswers[rule.id] !== rule.expectedValue);
      const tagsMiss = ((requirement.requiredZoneIds.length || requirement.requiredFeatureIds.length || requirement.excludedZoneIds.length || requirement.excludedFeatureIds.length) && !candidate.labelsConfirmed)
        || requirement.requiredZoneIds.some(id => !candidate.zoneIds.includes(id)) || requirement.requiredFeatureIds.some(id => !candidate.featureIds.includes(id))
        || intersects(requirement.excludedZoneIds, candidate.zoneIds) || intersects(requirement.excludedFeatureIds, candidate.featureIds);
      const deviations = [
        requirement.areaM2 && Math.abs(s.areaM2 - requirement.areaM2) / requirement.areaM2,
        requirement.lengthMm && Math.abs(s.lengthMm - requirement.lengthMm) / requirement.lengthMm,
        requirement.widthMm && Math.abs(s.widthMm - requirement.widthMm) / requirement.widthMm,
      ].filter((value): value is number => typeof value === 'number');
      const deviation = Math.max(0, ...deviations);
      const dimensionMiss = deviation > 0.3 + Number.EPSILON;
      if (systemMiss) diagnostics.exclusions.productSystem++;
      if (heightMiss) diagnostics.exclusions.height++;
      if (applicabilityMiss) diagnostics.exclusions.applicability++;
      if (tagsMiss) diagnostics.exclusions.tags++;
      if (dimensionMiss) diagnostics.exclusions.dimensions++;
      if (systemMiss || heightMiss || applicabilityMiss || tagsMiss || dimensionMiss) continue;
      
      const item = toItem(candidate, 'reference');
      const pendingConfirmations: PendingConfirmation[] = missingFields.map(field => ({ type: 'missing_field' as const, field, message: `需补充${field}` }));
      item.pendingConfirmations = pendingConfirmations;
      for (const rule of candidate.applicabilityRules) {
        if (requirement.applicabilityAnswers[rule.id] === undefined) {
          const question = applicabilityQuestions.find(q => q.id === rule.id);
          item.pendingConfirmations.push({
            type: 'applicability_question',
            id: rule.id,
            label: question?.label,
            helpText: question?.helpText,
            message: question ? `需确认：${question.label}` : `需确认适用条件：${rule.id}`,
          });
        }
      }
      
      for (const [field, label] of [['lengthMm', '长'], ['widthMm', '宽']] as const) {
        if (requirement[field] && requirement[field] !== s[field]) {
          item.differences.push({ field, requested: `${label} ${requirement[field]! / 1000} m`, actual: `${label} ${s[field] / 1000} m`, reason: '尺寸不同，需重新设计并核验，不可直接施工' });
        }
      }
      if (requirement.areaM2 && requirement.areaM2 !== s.areaM2) {
        item.differences.push({ field: 'areaM2', requested: `${requirement.areaM2} ㎡`, actual: `${s.areaM2} ㎡`, reason: '面积与所需条件不同' });
      }
      if (requirement.openingCount && requirement.openingCount !== s.openingCount) {
        item.differences.push({ field: 'openingCount', requested: `${requirement.openingCount} 面`, actual: `${s.openingCount} 面`, reason: '开口数不同，需重新设计并核验' });
      }
      
      if (!item.differences.length && !item.pendingConfirmations.length) {
        item.matchType = 'direct';
        item.reasons = ['长宽、开口与已提供结构条件一致', '方案实际高度未超过场馆限高', '所需适用条件已确认'];
      }
      
      let preference = 0;
      if (requirement.styleIds.length) {
        if (candidate.styleId && requirement.styleIds.includes(candidate.styleId)) preference += 3;
        else item.preferenceMisses.push('风格未命中所选偏好');
      }
      if (requirement.industryIds.length) {
        if (intersects(requirement.industryIds, candidate.industryIds)) preference += 2;
        else item.preferenceMisses.push('行业未命中所选偏好');
      }
      if (requirement.budgetTierId) {
        if (requirement.budgetTierId === candidate.budgetTierId) preference += 2;
        else item.preferenceMisses.push('材料购买预算档位与偏好不同');
      }
      
      preference += Math.min(2, requirement.zoneIds.filter(id => candidate.zoneIds.includes(id)).length);
      preference += Math.min(2, requirement.featureIds.filter(id => candidate.featureIds.includes(id)).length);
      preference += Math.min(3, requirement.keywords.filter(word => candidate.keywords.includes(word) && !candidate.zoneIds.includes(word) && !candidate.featureIds.includes(word)).length);
      
      ranked.push({ item, deviation, preference });
    }
    
    // Sort logic
    ranked.sort((a, b) => {
      const aDirect = a.item.matchType === 'direct' ? 1 : 0;
      const bDirect = b.item.matchType === 'direct' ? 1 : 0;
      if (aDirect !== bDirect) return bDirect - aDirect;
      if (a.deviation !== b.deviation) return a.deviation - b.deviation;
      if (a.item.pendingConfirmations.length !== b.item.pendingConfirmations.length) return a.item.pendingConfirmations.length - b.item.pendingConfirmations.length;
      if (a.preference !== b.preference) return b.preference - a.preference;
      return a.item.code < b.item.code ? -1 : (a.item.code > b.item.code ? 1 : 0);
    });
    
    items = ranked.slice(0, 3).map(row => row.item);
  }
  
  const counts = {
    direct: items.filter(item => item.matchType === 'direct').length,
    reference: items.filter(item => item.matchType === 'reference').length,
    random: items.filter(item => item.matchType === 'random').length,
    total: items.length
  };

  const labels: Record<keyof MatchDiagnostics['exclusions'], string> = {
    unverifiedChecklist: '清单未核验', incompleteAssets: '资产不完整', invalidData: '基础数据或审核信息不完整',
    productSystem: '产品体系不符', height: '超过场馆限高', applicability: '适用条件不符',
    tags: '必选或禁用功能条件不符', dimensions: '尺寸超出参考范围'
  };
  const orderedExclusions = (Object.keys(labels) as (keyof MatchDiagnostics['exclusions'])[])
    .filter(key => diagnostics.exclusions[key] > 0)
    .sort((a, b) => diagnostics.exclusions[b] - diagnostics.exclusions[a] || Object.keys(labels).indexOf(a) - Object.keys(labels).indexOf(b));
  const noMatchReasons = !diagnostics.reviewedPublished
    ? ['当前暂无已发布且审核有效的方案']
    : [
        mode === 'random' ? '当前暂无可随机推荐的方案（各排除原因可重叠）' : '当前条件组合暂无可采用或参考的方案（各排除原因可重叠）',
        ...orderedExclusions.map(key => `${labels[key]}：${diagnostics.exclusions[key]} 套${['unverifiedChecklist', 'incompleteAssets', 'invalidData'].includes(key) ? '已发布方案' : '可用方案'}`)
      ];
  
  return {
    ...base,
    status: items.length ? 'matched' : 'no_match',
    items,
    counts,
    diagnostics,
    reasons: !items.length
      ? noMatchReasons
      : !counts.direct && mode === 'filtered'
      ? ['未找到可直接采用方案，以下仅供参考']
      : [],
    suggestions: !items.length ? [
      ...(diagnostics.exclusions.dimensions ? ['可尝试调整展位长宽或面积，再重新查询'] : []),
      ...(diagnostics.exclusions.productSystem ? ['可检查所选产品体系，修改后重新查询'] : []),
      ...(diagnostics.exclusions.tags ? ['可检查必选或禁用的功能条件，修改后重新查询'] : []),
      '也可联系专业顾问确认可用方案'
    ] : []
  };
}
