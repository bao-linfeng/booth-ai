import { randomInt } from 'node:crypto';
import { isEmpty, invalid, rulesVersion, type Candidate, type MatchItem, type Requirement } from './domain.js';

const sideLabels = { front: '前侧', right: '右侧', back: '后侧', left: '左侧' };
const intersects = (left: string[], right: string[]) => left.some(value => right.includes(value));
const sameSet = (left: string[], right: string[]) => left.length === right.length && left.every(value => right.includes(value));

export function matchSchemes(candidates: Candidate[], requirement: Requirement, mode: 'random' | 'filtered', textProvided: boolean) {
  if (mode === 'random' && (textProvided || !isEmpty(requirement))) invalid('Random requires empty input');
  
  const missingFields = [
    !requirement.lengthMm && '展位长',
    !requirement.widthMm && '展位宽',
    !requirement.maxHeightMm && '场馆限高',
    !requirement.openingCount && '开口面数',
    !requirement.openSides && '开口方向'
  ].filter((value): value is string => !!value);
  
  const base = { mode, requirement, missingFields, rulesVersion };
  
  if (mode === 'filtered' && isEmpty(requirement)) {
    return { ...base, status: 'needs_clarification', items: [], counts: { direct: 0, reference: 0, random: 0, total: 0 }, reasons: ['请至少提供一项可识别的条件'], suggestions: [] };
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
      pendingConfirmations: ['随机推荐，尺寸、方向、限高及适用条件待确认']
    }));
  } else {
    const ranked: { item: MatchItem; deviation: number; preference: number }[] = [];
    
    for (const candidate of candidates) {
      const s = candidate.specifications;
      
      // 前置硬条件
      if (requirement.productSystemId && requirement.productSystemId !== s.productSystemId) continue;
      if (requirement.maxHeightMm && s.heightMm > requirement.maxHeightMm) continue;
      if (candidate.applicabilityRules.some(rule => requirement.applicabilityAnswers[rule.id] !== undefined && requirement.applicabilityAnswers[rule.id] !== rule.expectedValue)) continue;
      if ((requirement.requiredZoneIds.length || requirement.requiredFeatureIds.length || requirement.excludedZoneIds.length || requirement.excludedFeatureIds.length) && !candidate.labelsConfirmed) continue;
      if (requirement.requiredZoneIds.some(id => !candidate.zoneIds.includes(id)) || requirement.requiredFeatureIds.some(id => !candidate.featureIds.includes(id))) continue;
      if (intersects(requirement.excludedZoneIds, candidate.zoneIds) || intersects(requirement.excludedFeatureIds, candidate.featureIds)) continue;
      
      const item = toItem(candidate, 'reference');
      item.pendingConfirmations = missingFields.map(field => `需补充${field}`);
      for (const rule of candidate.applicabilityRules) {
        if (requirement.applicabilityAnswers[rule.id] === undefined) {
          item.pendingConfirmations.push(`需确认适用条件：${rule.id}`);
        }
      }
      
      const deviations = [
        requirement.areaM2 && Math.abs(s.areaM2 - requirement.areaM2) / requirement.areaM2,
        requirement.lengthMm && Math.abs(s.lengthMm - requirement.lengthMm) / requirement.lengthMm,
        requirement.widthMm && Math.abs(s.widthMm - requirement.widthMm) / requirement.widthMm,
      ].filter((value): value is number => typeof value === 'number');
      const deviation = Math.max(0, ...deviations);
      
      if (deviation > 0.3 + Number.EPSILON) continue;
      
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
      if (requirement.openSides && !sameSet(requirement.openSides, s.openSides)) {
        item.differences.push({ field: 'openSides', requested: requirement.openSides.map(side => sideLabels[side]).join('、'), actual: s.openSides.map(side => sideLabels[side]).join('、'), reason: '开口方向不同，未自动旋转或镜像方案' });
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
  
  return {
    ...base,
    status: items.length ? 'matched' : 'no_match',
    items,
    counts,
    reasons: !items.length
      ? [candidates.length ? '当前条件组合暂无可直接采用或范围内的参考方案' : '当前暂无满足公开审核及资产要求的方案']
      : !counts.direct && mode === 'filtered'
      ? ['未找到可直接采用方案，以下仅供参考']
      : [],
    suggestions: !items.length ? ['请核对已填写条件，或联系专业顾问'] : []
  };
}
