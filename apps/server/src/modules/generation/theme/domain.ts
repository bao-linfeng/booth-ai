export type ThemeInput = {
  industryId: string;
  styleId: string;
  brandColors?: string[];
  brandKeywords?: string;
};

export function normalizeThemeInput(input: ThemeInput): ThemeInput {
  const brandKeywords = input.brandKeywords?.trim() ?? '';
  if (/[\u0000-\u001f\u007f]/u.test(brandKeywords)) {
    throw Object.assign(new Error('Brand keywords contain control characters'), { statusCode: 400 });
  }
  return {
    industryId: input.industryId,
    styleId: input.styleId,
    brandColors: [...new Set((input.brandColors ?? []).map(c => c.toUpperCase()))],
    brandKeywords,
  };
}
