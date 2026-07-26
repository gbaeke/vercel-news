export const MAX_SEARCH_LENGTH = 200;

export function normalizeSearchQuery(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH);
}
