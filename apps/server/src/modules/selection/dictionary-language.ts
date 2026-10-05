export interface DictionaryAlias { locale: string; text: string; }
export interface DictionaryNames {
  label: string;
  value?: string;
  labels?: Record<string, string>;
  aliases?: DictionaryAlias[];
}

export function normalizeDictionaryTerm(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function dictionaryTerms(item: DictionaryNames): string[] {
  return [...new Set([item.label, item.value ?? '', ...Object.values(item.labels ?? {}),
    ...(item.aliases ?? []).map(alias => alias.text)].filter(Boolean))];
}

export function localizedLabel(item: DictionaryNames, locale: string): string {
  const requested = locale.toLowerCase();
  const entries = Object.entries(item.labels ?? {});
  return entries.find(([key]) => key.toLowerCase() === requested)?.[1]
    ?? entries.find(([key]) => key.toLowerCase() === requested.split('-')[0])?.[1]
    ?? item.label;
}

export function canonicalLocale(locale: string): string {
  try { return Intl.getCanonicalLocales(locale)[0]!; }
  catch { throw Object.assign(new Error('Invalid language code'), { statusCode: 400 }); }
}

export function resolveDictionaryTerms<T extends DictionaryNames & { id: string }>(items: T[], terms: string[]): string[] {
  return [...new Set(terms.map(term => {
    const normalized = normalizeDictionaryTerm(term);
    const matches = items.filter(item => dictionaryTerms(item).some(value => normalizeDictionaryTerm(value) === normalized));
    if (matches.length !== 1) throw Object.assign(new Error(matches.length
      ? `标签存在多个候选，请确认：${term}` : `未映射的标签：${term}`), { statusCode: 400 });
    return matches[0]!.id;
  }))];
}
