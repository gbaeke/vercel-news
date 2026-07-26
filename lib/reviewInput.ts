const POSTGRES_INTEGER_MAX = 2_147_483_647;

export const MAX_REWRITE_FEEDBACK_LENGTH = 4_000;

export function parseArticleId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= POSTGRES_INTEGER_MAX ? value : null;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;

  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id <= POSTGRES_INTEGER_MAX ? id : null;
}

export type FeedbackValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateRewriteFeedback(value: unknown): FeedbackValidation {
  const feedback = typeof value === 'string' ? value.trim() : '';
  if (!feedback) {
    return { ok: false, error: 'Please describe what should change in the rewrite.' };
  }
  if (feedback.length > MAX_REWRITE_FEEDBACK_LENGTH) {
    return {
      ok: false,
      error: `Rewrite feedback must be ${MAX_REWRITE_FEEDBACK_LENGTH.toLocaleString('en-GB')} characters or fewer.`,
    };
  }
  return { ok: true, value: feedback };
}
