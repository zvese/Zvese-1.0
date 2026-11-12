export const CATALOG_PAGE_SIZE = 24;
export function catalogPage(value: unknown) {
  const number = Number(value ?? 1);
  return Number.isSafeInteger(number) && number > 0 && number <= 10000 ? number : 1;
}
// Escape every regex metacharacter for literal, case-insensitive substring search.
// imatch avoids PostgREST's ILIKE '*' alias changing a literal asterisk into '%'.
// Separately quote OR values so commas/parentheses cannot alter filter grammar.
export function containsPattern(term: string) { return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function quotedFilter(value: string) { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }
