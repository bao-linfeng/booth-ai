import { emptyRequirement, rulesVersion, type Catalog, type Requirement } from './domain.js';

export function parseRequirement(text: string, form: Requirement, catalog: Catalog) {
  const requirement = structuredClone(form);
  const fieldSources: Record<string, { source: 'form' | 'text' | 'derived'; evidence?: string }> = {};
  const overrides: { field: string; previousValue: unknown; value: unknown; evidence: string }[] = [];
  const clarifications: { field: string; reason: string; question: string; candidates: string[] }[] = [];
  const consumed: [number, number][] = [];
  
  for (const field of Object.keys(emptyRequirement())) {
    fieldSources[field] = { source: 'form' };
  }
  
  const set = <K extends keyof Requirement>(field: K, value: Requirement[K], evidence: string) => {
    if (JSON.stringify(requirement[field]) !== JSON.stringify(value)) {
      overrides.push({ field, previousValue: requirement[field], value, evidence });
    }
    requirement[field] = value;
    fieldSources[field] = { source: 'text', evidence };
  };
  
  const consume = (match: RegExpMatchArray) => consumed.push([match.index!, match.index! + match[0].length]);
  const clarify = (field: string, question: string) => clarifications.push({ field, reason: 'NEEDS_CONFIRMATION', question, candidates: [] });
  
  const normalized = text.trim();
  
  // Dimensions
  for (const [field, label] of [['lengthMm', '(?:展位)?长(?:度)?'], ['widthMm', '(?:展位)?宽(?:度)?'], ['maxHeightMm', '(?:场馆)?限高']] as const) {
    const matches = [...normalized.matchAll(new RegExp(`${label}\\s*(?:为|是|改为|改成|=|：)?\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|厘米|mm|cm|米|m)(?![a-z])`, 'gi'))];
    const values = matches.map(match => Number(match[1]) * (/毫米|mm/i.test(match[2]!) ? 1 : /厘米|cm/i.test(match[2]!) ? 10 : 1000));
    
    if (new Set(values).size > 1) {
      clarify(field, '同一尺寸出现多个数值，请在表单确认最终值。');
    } else if (matches[0]) {
      const value = values[0]!;
      if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) {
        clarify(field, '尺寸需为正数，精确到毫米，请修正。');
      } else {
        set(field, value, matches[0][0]);
      }
    }
    matches.forEach(consume);
  }
  
  // Area
  const areaMatches = [...normalized.matchAll(/(?:面积\s*(?:为|是|=|：)?\s*)?(\d+(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²)/gi)];
  if (new Set(areaMatches.map(match => Number(match[1]))).size > 1) {
    clarify('areaM2', '出现多个面积，请确认最终面积。');
  } else if (areaMatches[0]) {
    set('areaM2', Number(areaMatches[0][1]), areaMatches[0][0]);
  }
  areaMatches.forEach(consume);
  
  // Implicit dimensions
  for (const match of normalized.matchAll(/\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?(?:\s*(?:米|m))?/g)) {
    clarify('lengthMm', `“${match[0]}”的长宽方向不明确，请按左右为长、前后为宽确认。`);
    consume(match);
  }
  
  // Openings
  const opening = [...normalized.matchAll(/([一二三四1234两])\s*面(?:开口)?|岛式/g)];
  const numeral: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 };
  const counts = opening.map(match => match[0] === '岛式' ? 4 : numeral[match[1]!] ?? Number(match[1]));
  
  if (new Set(counts).size > 1) {
    clarify('openingCount', '开口面数存在冲突，请确认。');
  } else if (opening[0]) {
    set('openingCount', counts[0]!, opening[0][0]);
  }
  opening.forEach(consume);
  
  // Dictionaries
  for (const [field, options] of [
    ['productSystemId', catalog.productSystems],
    ['styleIds', catalog.styles],
    ['industryIds', catalog.industries],
    ['budgetTierId', catalog.budgetTiers],
    ['zoneIds', catalog.zones],
    ['featureIds', catalog.features]
  ] as const) {
    const found: string[] = [];
    const required: string[] = [];
    const excluded: string[] = [];
    
    for (const option of options) {
      let start = 0;
      while (start < normalized.length) {
        const index = normalized.indexOf(option.label, start);
        if (index < 0) break;
        
        const prefix = normalized.slice(Math.max(0, index - 10), index).split(/[，,。；;]/).at(-1) ?? '';
        const negative = /(?:不要|不需要|禁止|不能有|不含|不能包含|无)\s*$/.test(prefix);
        const strong = /(?:必须|务必|一定要)(?:有|包含|带)?\s*$/.test(prefix);
        
        if (field === 'zoneIds' || field === 'featureIds') {
          (negative ? excluded : strong ? required : found).push(option.id);
        } else if (negative || strong) {
          clarify(field, `“${prefix}${option.label}”包含强约束，请明确确认条件。`);
        } else {
          found.push(option.id);
        }
        
        consumed.push([index, index + option.label.length]);
        start = index + option.label.length;
      }
    }
    
    if (found.length) {
      const unique = [...new Set(found)];
      if (field === 'productSystemId' || field === 'budgetTierId') {
        if (unique.length > 1) clarify(field, '识别到多个单选条件，请确认。');
        else set(field, unique[0]!, '原文中的字典名称');
      } else {
        set(field, unique, '原文中的字典名称');
      }
    }
    
    if (field === 'zoneIds' || field === 'featureIds') {
      if (required.length) set(field === 'zoneIds' ? 'requiredZoneIds' : 'requiredFeatureIds', [...new Set(required)], '原文明确必须项');
      if (excluded.length) set(field === 'zoneIds' ? 'excludedZoneIds' : 'excludedFeatureIds', [...new Set(excluded)], '原文明确禁止项');
    }
  }
  
  if (requirement.lengthMm && requirement.widthMm) {
    const area = requirement.lengthMm * requirement.widthMm / 1_000_000;
    if (areaMatches.length && requirement.areaM2 !== area) {
      clarify('areaM2', '文字面积与长宽乘积冲突，请修正。');
    }
    requirement.areaM2 = area;
    fieldSources.areaM2 = { source: 'derived' };
  }
  
  if (requirement.requiredZoneIds.some(id => requirement.excludedZoneIds.includes(id)) || requirement.requiredFeatureIds.some(id => requirement.excludedFeatureIds.includes(id))) {
    clarify('keywords', '同一功能同时被要求和禁止，请修正。');
  }
  
  const remainder = [...normalized].map((char, index) => consumed.some(([start, end]) => index >= start && index < end) ? ' ' : char).join('');
  const unhandledText = remainder.split(/[，,。；;\n]/).map(value => value.trim()).filter(value => value && !/^(?:的|展台|展位|风格|行业|开口|需要|有|和|与|及|想要|希望|必须|不要|不需要|带|一个|一点|简洁|改成|改为|\s)+$/.test(value));
  
  if (unhandledText.length) {
    clarify('text', '部分文字尚未可靠识别，请在表单补充条件，或转人工确认。');
  }
  
  if (!consumed.length && normalized) {
    clarify('text', '未识别到可靠条件，请补充明确尺寸或选择表单条件。');
  }
  
  return {
    status: clarifications.length ? 'needs_clarification' : 'ready',
    requirement,
    parser: 'rules',
    degraded: true,
    fieldSources,
    overrides,
    clarifications,
    unhandledText,
    warnings: [{ code: 'RULES_ONLY', message: '当前使用规则识别，语言模型尚未配置；未识别内容需人工确认。' }],
    rulesVersion
  };
}
