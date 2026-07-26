import { describe, expect, it } from 'vitest';
import {
  MAX_REWRITE_FEEDBACK_LENGTH,
  parseArticleId,
  validateRewriteFeedback,
} from '../lib/reviewInput';

describe('review input validation', () => {
  it('accepts positive Postgres integer article ids', () => {
    expect(parseArticleId('42')).toBe(42);
    expect(parseArticleId(42)).toBe(42);
  });

  it('rejects malformed and out-of-range article ids before they reach Postgres', () => {
    expect(parseArticleId('not-a-number')).toBeNull();
    expect(parseArticleId('1.5')).toBeNull();
    expect(parseArticleId('0')).toBeNull();
    expect(parseArticleId('-1')).toBeNull();
    expect(parseArticleId('2147483648')).toBeNull();
  });

  it('trims valid rewrite feedback', () => {
    expect(validateRewriteFeedback('  make it clearer  ')).toEqual({
      ok: true,
      value: 'make it clearer',
    });
  });

  it('rejects empty and oversized rewrite feedback', () => {
    expect(validateRewriteFeedback('   ').ok).toBe(false);
    expect(validateRewriteFeedback('x'.repeat(MAX_REWRITE_FEEDBACK_LENGTH + 1)).ok).toBe(false);
  });
});
