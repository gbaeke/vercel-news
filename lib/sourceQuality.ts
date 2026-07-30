export const MAX_SOURCE_LENGTH = 100_000;
export const MAX_PROMPT_SOURCE_LENGTH = 30_000;
export const MIN_PAGE_SOURCE_LENGTH = 400;
export const MIN_RSS_SOURCE_LENGTH = 500;

export interface SourceAssessment {
  ok: boolean;
  reason: string | null;
}

export function assessSource(text: string, minimumLength: number): SourceAssessment {
  if (looksTruncated(text)) {
    return { ok: false, reason: 'appears to be a truncated preview' };
  }
  if (text.length < minimumLength) {
    return { ok: false, reason: `only ${text.length} characters (need at least ${minimumLength})` };
  }
  if (text.length > MAX_SOURCE_LENGTH) {
    return { ok: false, reason: `exceeds the ${MAX_SOURCE_LENGTH}-character safety limit` };
  }
  return { ok: true, reason: null };
}

// Feed providers commonly append labels such as "Update Type" after an
// ellipsized social preview. Looking for that combination avoids treating
// ordinary prose that contains an ellipsis as incomplete.
export function looksTruncated(text: string): boolean {
  const normalized = text.trim();
  return /(?:…|\.\.\.)\s*$/.test(normalized)
    || /\b[\p{L}\p{N}]{1,30}\.\.\.\s+(?:update type|services|categories|tags|read more)\b/iu.test(normalized);
}

// Preserve the beginning and conclusion of an unusually long source rather
// than silently dropping its ending before it reaches a model prompt.
export function sourceForPrompt(text: string): string {
  if (text.length <= MAX_PROMPT_SOURCE_LENGTH) return text;
  const headLength = 20_000;
  const tailLength = MAX_PROMPT_SOURCE_LENGTH - headLength;
  return `${text.slice(0, headLength)}\n\n[Middle of source omitted for prompt length. Do not refer to this notice in the article.]\n\n${text.slice(-tailLength)}`;
}

// A story should discuss the subject, never the mechanics or quality of the
// source supplied to the writer. Keep this narrow to avoid rejecting normal
// use of the word "source" in reporting.
export function containsSourceProcessLanguage(text: string): boolean {
  return /\b(?:the|this|provided|supplied)\s+(?:source(?:\s+(?:material|text|article))?|excerpt)\s+(?:cuts?\s+off|ends?|lacks?|omits?|does(?:n't| not)|is(?:n't| not)|was(?:n't| not)|provides?\s+only)\b/i.test(text)
    || /\b(?:the|this)\s+source\s+material\b/i.test(text)
    || /\b(?:provided|supplied)\s+excerpt\b/i.test(text);
}
